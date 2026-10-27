export interface CopyCreationPayload {
  rewriteRequirements: string
  sourceCopy: string
  maxCharsPerLine?: number
}

export interface CopyCreationResult {
  text: string
}
