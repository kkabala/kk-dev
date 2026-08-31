export type ProductInfo = Readonly<{
  name: "Exoframe";
  version: "0.0.0";
  private: true;
}>;

const PRODUCT_INFO: ProductInfo = Object.freeze({
  name: "Exoframe",
  version: "0.0.0",
  private: true,
});

export function productInfo(): ProductInfo {
  return PRODUCT_INFO;
}
