export function l2Normalize(values: ArrayLike<number>): Float32Array {
  let sumOfSquares = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as number;
    sumOfSquares += value * value;
  }
  const norm = Math.sqrt(sumOfSquares);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new RangeError("Cannot normalize a vector with a zero or non-finite norm.");
  }
  const result = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    result[index] = (values[index] as number) / norm;
  }
  return result;
}

/** Keeps the leading `dimensions` values (Matryoshka truncation) and renormalizes. */
export function truncateAndNormalize(vector: ArrayLike<number>, dimensions: number): Float32Array {
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > vector.length) {
    throw new RangeError(
      `Cannot truncate a ${vector.length}-dimension vector to ${dimensions} dimensions.`,
    );
  }
  const head = new Float32Array(dimensions);
  for (let index = 0; index < dimensions; index += 1) {
    head[index] = vector[index] as number;
  }
  return l2Normalize(head);
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    throw new RangeError(`Vector length mismatch: ${a.length} versus ${b.length}.`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index] as number;
    const y = b[index] as number;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (!Number.isFinite(denominator) || denominator === 0) {
    throw new RangeError("Cannot compare vectors with a zero or non-finite norm.");
  }
  return dot / denominator;
}
