import { defineEventHandler } from 'h3'
import { db } from '../../utils/db'
import { getMealieStatus } from '../../utils/mealie/sync'

export default defineEventHandler(() => getMealieStatus(db))
