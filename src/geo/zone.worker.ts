/// <reference lib="webworker" />
import { loadData } from '../data/load'
import { buildCtx, computeZone, type Ctx } from './zone'
import type { ComputeRequest, ComputeResult } from '../types/game'
import type { AppData } from '../data/types'

// The data is normally pushed in from the UI thread (so the worker never has to
// fetch it itself — that would break on a sub-path deploy like GitHub Pages).
// loadData() is kept only as a dev-time fallback.
let ctx: Ctx | null = null
let ctxPromise: Promise<Ctx> | null = null

function getCtx(): Promise<Ctx> {
  if (ctx) return Promise.resolve(ctx)
  if (!ctxPromise) ctxPromise = loadData().then((d) => (ctx = buildCtx(d)))
  return ctxPromise
}

self.onmessage = async (ev: MessageEvent<ComputeRequest | { type: 'init'; data: AppData }>) => {
  const msg = ev.data
  if (msg.type === 'init') {
    try { ctx = buildCtx(msg.data) } catch (e) { console.error('zone worker init failed', e) }
    return
  }
  if (msg.type !== 'compute') return
  try {
    const c = await getCtx()
    const r = computeZone(c, msg.log, msg.m2Excluded, msg.hidingRadiusM)
    const result: ComputeResult = {
      type: 'result', zone: r.zone, shade: r.shade, emptyConstraint: r.emptyConstraint, areaKm2: r.areaKm2
    }
    ;(self as unknown as Worker).postMessage(result)
  } catch (e) {
    ;(self as unknown as Worker).postMessage({
      type: 'result', zone: null, shade: null, emptyConstraint: false, areaKm2: 0, error: String(e)
    } as ComputeResult)
  }
}
