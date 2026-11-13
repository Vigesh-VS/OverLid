// Minimal typing for the part of mammoth's browser build Overlid uses.
declare module "mammoth/mammoth.browser.min.js" {
  interface Result {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }
  const mammoth: {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<Result>;
  };
  export default mammoth;
}
