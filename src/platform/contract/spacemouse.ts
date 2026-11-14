/** Only 3Dconnexion multi-axis interfaces, including the Logitech-era controllers. */
export function isSpaceMouse(device: {
  readonly vendorId: number
  readonly productId: number
  readonly collections: readonly {
    readonly usagePage: number
    readonly usage: number
  }[]
}): boolean {
  const knownVendor =
    device.vendorId === 0x256f ||
    (device.vendorId === 0x046d &&
      [0xc625, 0xc626, 0xc627, 0xc628, 0xc629, 0xc62b].includes(
        device.productId
      ))
  return (
    knownVendor &&
    device.collections.some(
      ({ usagePage, usage }) => usagePage === 1 && usage === 8
    )
  )
}
