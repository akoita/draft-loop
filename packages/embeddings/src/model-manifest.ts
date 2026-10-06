export type GraniteEmbeddingTier = "311m" | "97m";

export const defaultGraniteEmbeddingTier: GraniteEmbeddingTier = "311m";

export interface GraniteModelFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface GraniteEmbeddingModel {
  readonly tier: GraniteEmbeddingTier;
  readonly modelId: string;
  readonly sourceRepository: string;
  readonly revision: string;
  readonly license: "Apache-2.0";
  readonly nativeDimensions: number;
  readonly matryoshkaDimensions: readonly number[];
  readonly pooling: "cls";
  readonly queryPrefix: string;
  readonly documentPrefix: string;
  readonly defaultMaxTokens: number;
  readonly maximumMaxTokens: number;
  readonly files: {
    readonly model: GraniteModelFile;
    readonly tokenizer: GraniteModelFile;
    readonly tokenizerConfig: GraniteModelFile;
  };
}

function freezeModel(model: GraniteEmbeddingModel): GraniteEmbeddingModel {
  Object.freeze(model.matryoshkaDimensions);
  Object.freeze(model.files.model);
  Object.freeze(model.files.tokenizer);
  Object.freeze(model.files.tokenizerConfig);
  Object.freeze(model.files);
  return Object.freeze(model);
}

export const graniteEmbeddingModels: Readonly<Record<GraniteEmbeddingTier, GraniteEmbeddingModel>> =
  Object.freeze({
    "311m": freezeModel({
      tier: "311m",
      modelId: "ibm-granite/granite-embedding-311m-multilingual-r2",
      sourceRepository: "onnx-community/granite-embedding-311m-multilingual-r2-ONNX",
      revision: "8f039f21d4181327268271bea4b11ddcc7eef88d",
      license: "Apache-2.0",
      nativeDimensions: 768,
      matryoshkaDimensions: [768, 512, 384, 256, 128],
      pooling: "cls",
      queryPrefix: "",
      documentPrefix: "",
      defaultMaxTokens: 512,
      maximumMaxTokens: 8192,
      files: {
        model: {
          path: "onnx/model_int8.onnx",
          sizeBytes: 312556945,
          sha256: "54d33d10f865516eda6770d7b0bbf5eaece861058907da0ad095c62e52958c3d",
        },
        tokenizer: {
          path: "tokenizer.json",
          sizeBytes: 33384821,
          sha256: "0087c868b33bad550a78a08d19798cfd7f713cde4f020803b8f51f405503e15f",
        },
        tokenizerConfig: {
          path: "tokenizer_config.json",
          sizeBytes: 1155500,
          sha256: "7947bdf0378520e69ca412b8c4dacd1cffa8aef099f851fdd5c65aa27c6b36a0",
        },
      },
    }),
    "97m": freezeModel({
      tier: "97m",
      modelId: "ibm-granite/granite-embedding-97m-multilingual-r2",
      sourceRepository: "onnx-community/granite-embedding-97m-multilingual-r2-ONNX",
      revision: "536a9f241cb3f02a9c5995a1e708c784bd274859",
      license: "Apache-2.0",
      nativeDimensions: 384,
      matryoshkaDimensions: [384],
      pooling: "cls",
      queryPrefix: "",
      documentPrefix: "",
      defaultMaxTokens: 512,
      maximumMaxTokens: 8192,
      files: {
        model: {
          path: "onnx/model_int8.onnx",
          sizeBytes: 97858099,
          sha256: "704c1ebca5fbb7cd83ced41827658ac4c9990c64f7f2874d22b78044e5022e22",
        },
        tokenizer: {
          path: "tokenizer.json",
          sizeBytes: 25301671,
          sha256: "51947676cae1f991fa51c6b9a24e14ee5460e5f0b9f692f13bb3159829d1592a",
        },
        tokenizerConfig: {
          path: "tokenizer_config.json",
          sizeBytes: 12860,
          sha256: "6ed69389e30a8ecabfce2f9ebcdf0c908b34056f24d994340f2f216521c057d5",
        },
      },
    }),
  });

export function getGraniteEmbeddingModel(
  tier: GraniteEmbeddingTier = defaultGraniteEmbeddingTier,
): GraniteEmbeddingModel {
  return graniteEmbeddingModels[tier];
}
