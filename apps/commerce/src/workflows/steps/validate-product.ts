import { MedusaError, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep } from "@medusajs/framework/workflows-sdk"

export type ValidateProductInput = {
  product_id: string
}

/**
 * Fails the workflow early if the product does not exist.
 *
 * Two things this step demonstrates:
 *
 * 1. READ-ONLY STEPS NEED NO COMPENSATION. `createStep` takes an optional third
 *    argument; this step omits it because there is nothing to undo. Only steps
 *    that change state need a rollback.
 *
 * 2. This is how you touch ANOTHER module from a workflow. We do not import the
 *    product module's service — we resolve Query from the container and ask it
 *    for the product. Query is the read side of Medusa's module system: it knows
 *    about every module and every link, so it can answer questions no single
 *    module could.
 *
 * Ordering it first is deliberate: cheap validation before expensive writes means
 * fewer rollbacks to reason about.
 */
export const validateProductStep = createStep(
  "validate-product",
  async ({ product_id }: ValidateProductInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data } = await query.graph({
      entity: "product",
      fields: ["id", "title"],
      filters: { id: product_id },
    })

    if (data.length === 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Product '${product_id}' does not exist, so it cannot be reviewed.`
      )
    }
  }
)
