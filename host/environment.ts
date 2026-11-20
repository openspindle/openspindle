/** Accept the existing service configuration during the product-name transition. */
export function hostEnvironment(name: string): string | undefined {
  return process.env[`SPINNVILL_${name}`] ?? process.env[`OPENSPINDLE_${name}`]
}
