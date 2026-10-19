import { defineEventHandler, getRouterParam } from 'h3'
import { db } from '../../utils/db'
import { findRecipe, parseRecipeId } from '../../utils/recipe-query'

export default defineEventHandler(async event => findRecipe(db(), parseRecipeId(getRouterParam(event, 'id'))))
