export type GraniteEmbeddingTier = "311m" | "97m" | "eg2-text";

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
  readonly pooling: "cls" | "mean";
  readonly queryPrefix: string;
  readonly documentPrefix: string;
  readonly defaultMaxTokens: number;
  readonly maximumMaxTokens: number;
  /**
   * Optional modality inputs the graph declares but text never uses. Each is fed as a float32
   * tensor with zero rows and `width` columns.
   */
  readonly emptyFeatureInputs?: readonly { readonly name: string; readonly width: number }[];
  readonly files: {
    readonly model: GraniteModelFile;
    /** External ONNX weights that must sit next to `model`, named by the graph itself. */
    readonly modelData?: GraniteModelFile;
    readonly tokenizer: GraniteModelFile;
    readonly tokenizerConfig: GraniteModelFile;
  };
}

function freezeModel(model: GraniteEmbeddingModel): GraniteEmbeddingModel {
  for (const input of model.emptyFeatureInputs ?? []) Object.freeze(input);
  if (model.emptyFeatureInputs !== undefined) Object.freeze(model.emptyFeatureInputs);
  Object.freeze(model.matryoshkaDimensions);
  Object.freeze(model.files.model);
  if (model.files.modelData !== undefined) Object.freeze(model.files.modelData);
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
    "eg2-text": freezeModel({
      tier: "eg2-text",
      modelId: "google/embeddinggemma-2",
      sourceRepository: "onnx-community/embeddinggemma-2-ONNX",
      revision: "daa72c51243991dfcaf9f9137d2c573d8f7790c0",
      license: "Apache-2.0",
      nativeDimensions: 768,
      matryoshkaDimensions: [768, 512, 256, 128],
      pooling: "mean",
      queryPrefix: "task: search result | query: ",
      documentPrefix: "title: none | text: ",
      defaultMaxTokens: 512,
      maximumMaxTokens: 8192,
      emptyFeatureInputs: [
        { name: "image_features", width: 512 },
        { name: "video_features", width: 512 },
        { name: "audio_features", width: 512 },
      ],
      files: {
        model: {
          path: "onnx/model_q4.onnx",
          sizeBytes: 490742,
          sha256: "f9eeba97acddf139b8ee2ddf04bc30dceafa88de93fadf74d7644e0d61a477a9",
        },
        modelData: {
          path: "onnx/model_q4.onnx_data",
          sizeBytes: 174028800,
          sha256: "c3975f2d1ab7a1878ae31a7d7a9b7804a827aff3800b60dfceafce21cac3df49",
        },
        tokenizer: {
          path: "tokenizer.json",
          sizeBytes: 32170510,
          sha256: "4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4",
        },
        tokenizerConfig: {
          path: "tokenizer_config.json",
          sizeBytes: 1599,
          sha256: "17bd5d6e9364ca49a534e1502076593317c298d4a663623091ed45388f004874",
        },
      },
    }),
  });

/** Every file a tier needs on disk, in install order. */
export function embeddingModelFiles(model: GraniteEmbeddingModel): readonly GraniteModelFile[] {
  const { model: graph, modelData, tokenizer, tokenizerConfig } = model.files;
  return modelData === undefined
    ? [graph, tokenizer, tokenizerConfig]
    : [graph, modelData, tokenizer, tokenizerConfig];
}

export function getGraniteEmbeddingModel(
  tier: GraniteEmbeddingTier = defaultGraniteEmbeddingTier,
): GraniteEmbeddingModel {
  return graniteEmbeddingModels[tier];
}
