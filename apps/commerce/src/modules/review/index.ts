import { Module } from "@medusajs/framework/utils"

import ReviewModuleService from "./service"

/**
 * The module's public surface.
 *
 * REVIEW_MODULE is the key the module registers under in Medusa's DI container.
 * Anywhere you need the service you resolve it by this string:
 *
 *   const reviewService = req.scope.resolve(REVIEW_MODULE)
 *
 * Importing the service class directly would work in TypeScript and be wrong in
 * spirit: the container is what makes the module swappable and testable.
 */
export const REVIEW_MODULE = "review"

export default Module(REVIEW_MODULE, {
  service: ReviewModuleService,
})
