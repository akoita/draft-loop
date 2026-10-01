interface PdfTextBaseline {
  readonly directionX: number;
  readonly directionY: number;
  readonly offset: number;
  readonly verticalOffsetPerUnit: number;
}

type PdfOperand = number | undefined;

const numberTokenPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
const baselineTolerance = 0.01;
const directionTolerance = 0.000001;

function skipLiteral(value: string, start: number): number {
  let depth = 1;
  let index = start + 1;
  while (index < value.length && depth > 0) {
    const character = value[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    index += 1;
  }
  return index;
}

function sameBaseline(left: PdfTextBaseline, right: PdfTextBaseline): boolean {
  return (
    Math.abs(left.directionX - right.directionX) <= directionTolerance &&
    Math.abs(left.directionY - right.directionY) <= directionTolerance &&
    Math.abs(left.offset - right.offset) <= baselineTolerance
  );
}

function textBaseline(matrix: readonly number[]): PdfTextBaseline | undefined {
  const [a, b, c, d, e, f] = matrix;
  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined ||
    e === undefined ||
    f === undefined ||
    !matrix.every(Number.isFinite)
  ) {
    return undefined;
  }
  const magnitude = Math.hypot(a, b);
  if (magnitude === 0) return undefined;

  let directionX = a / magnitude;
  let directionY = b / magnitude;
  if (directionX < 0 || (directionX === 0 && directionY < 0)) {
    directionX = -directionX;
    directionY = -directionY;
  }
  return {
    directionX,
    directionY,
    offset: -directionY * e + directionX * f,
    verticalOffsetPerUnit: -directionY * c + directionX * d,
  };
}

/** Joins PDF text-show fragments unless operators establish a new text line. */
export class PdfTextLayoutCollector {
  private text = "";
  private lineBreakPending = false;
  private previousBaseline: PdfTextBaseline | null | undefined;

  append(fragment: string, interveningOperators: string): void {
    this.lineBreakPending ||= this.consumeOperators(interveningOperators);
    if (fragment === "") return;

    if (this.text !== "" && this.lineBreakPending && !this.text.endsWith("\n")) {
      this.text += "\n";
    }
    this.text += fragment;
    this.lineBreakPending = false;
  }

  toString(): string {
    return this.text;
  }

  private consumeOperators(prefix: string): boolean {
    let lineBreak = false;
    let index = 0;
    let arrayDepth = 0;
    let dictionaryDepth = 0;
    const operands: PdfOperand[] = [];

    const lastNumbers = (count: number): readonly number[] | undefined => {
      const values = operands.slice(-count);
      return values.length === count && values.every((value) => typeof value === "number")
        ? (values as number[])
        : undefined;
    };

    while (index < prefix.length) {
      const character = prefix[index] ?? "";
      if (/\s/u.test(character)) {
        index += 1;
        continue;
      }
      if (character === "%") {
        while (index < prefix.length && prefix[index] !== "\n" && prefix[index] !== "\r") {
          index += 1;
        }
        continue;
      }
      if (character === "(") {
        index = skipLiteral(prefix, index);
        if (arrayDepth === 0 && dictionaryDepth === 0) operands.push(undefined);
        continue;
      }
      if (character === "<" && prefix.startsWith("<<", index)) {
        dictionaryDepth += 1;
        index += 2;
        continue;
      }
      if (character === ">" && prefix.startsWith(">>", index)) {
        dictionaryDepth = Math.max(0, dictionaryDepth - 1);
        index += 2;
        if (arrayDepth === 0 && dictionaryDepth === 0) operands.push(undefined);
        continue;
      }
      if (character === "<") {
        const closing = prefix.indexOf(">", index + 1);
        index = closing < 0 ? prefix.length : closing + 1;
        if (arrayDepth === 0 && dictionaryDepth === 0) operands.push(undefined);
        continue;
      }
      if (character === "[") {
        arrayDepth += 1;
        index += 1;
        continue;
      }
      if (character === "]") {
        arrayDepth = Math.max(0, arrayDepth - 1);
        index += 1;
        if (arrayDepth === 0 && dictionaryDepth === 0) operands.push(undefined);
        continue;
      }
      if (arrayDepth > 0 || dictionaryDepth > 0) {
        index += 1;
        continue;
      }
      if (character === "/") {
        index += 1;
        while (index < prefix.length && !/[\s()[\]{}<>/%]/u.test(prefix[index] ?? "")) {
          index += 1;
        }
        operands.push(undefined);
        continue;
      }

      let end = index + 1;
      while (end < prefix.length && !/[\s()[\]{}<>/%]/u.test(prefix[end] ?? "")) end += 1;
      const token = prefix.slice(index, end);
      index = end;
      if (numberTokenPattern.test(token)) {
        operands.push(Number(token));
        continue;
      }

      if (token === "BT" || token === "ET") {
        lineBreak = true;
        this.previousBaseline = undefined;
      } else if (token === "T*") {
        lineBreak = true;
        this.previousBaseline = null;
      } else if (token === "Td" || token === "TD") {
        const values = lastNumbers(2);
        const deltaY = values?.[1];
        if (deltaY === undefined) {
          lineBreak = true;
          this.previousBaseline = null;
        } else if (deltaY !== 0) {
          lineBreak = true;
          if (this.previousBaseline === undefined) {
            this.previousBaseline = null;
          } else if (this.previousBaseline !== null) {
            this.previousBaseline = {
              ...this.previousBaseline,
              offset:
                this.previousBaseline.offset + deltaY * this.previousBaseline.verticalOffsetPerUnit,
            };
          }
        }
      } else if (token === "Tm") {
        const values = lastNumbers(6);
        const baseline = values === undefined ? undefined : textBaseline(values);
        if (baseline === undefined) {
          lineBreak = true;
          this.previousBaseline = null;
        } else {
          if (
            this.previousBaseline === null ||
            (this.previousBaseline !== undefined && !sameBaseline(this.previousBaseline, baseline))
          ) {
            lineBreak = true;
          }
          this.previousBaseline = baseline;
        }
      }
      operands.length = 0;
    }
    return lineBreak;
  }
}
