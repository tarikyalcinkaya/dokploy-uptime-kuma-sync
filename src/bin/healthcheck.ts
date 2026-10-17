// Docker HEALTHCHECK: healthy while the loop keeps finishing cycles. Whether a cycle succeeded is
// the push heartbeat's job; this only catches a worker that hangs.
import { loadLivenessConfig } from '../infrastructure/config.js'
import { isAlive } from '../infrastructure/liveness.js'

const config = loadLivenessConfig()
const healthy =
  config.RUN_MODE === 'once' || (await isAlive(config.ALIVE_FILE, config.INTERVAL_SECONDS))
process.exitCode = healthy ? 0 : 1
