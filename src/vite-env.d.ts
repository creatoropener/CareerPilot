/// <reference types="vite/client" />

declare module 'mammoth/mammoth.browser.js' {
  interface Mammoth { extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }> }
  const mammoth: Mammoth;
  export default mammoth;
  export const extractRawText: Mammoth['extractRawText'];
}
