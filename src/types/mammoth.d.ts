// Minimal typing for the part of mammoth's browser build Overlid uses.
declare module "mammoth/mammoth.browser.min.js" {
  interface Result {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }
  interface ImageConverter {
    readonly __brand: "mammoth-image-converter";
  }
  const mammoth: {
    convertToHtml(
      input: { arrayBuffer: ArrayBuffer },
      options?: { convertImage?: ImageConverter },
    ): Promise<Result>;
    images: {
      imgElement(convert: (image: unknown) => Promise<{ src: string }>): ImageConverter;
    };
  };
  export default mammoth;
}
