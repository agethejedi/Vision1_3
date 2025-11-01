// EVM adapter for Vision using your existing X-Wallet Worker endpoints
// Fully aligned with current Cloudflare env vars (OFAC_SET, SCAM_CLUSTERS, etc.)

const rootScope =
  typeof self !== "undefined" ? self :
  typeof window !== "undefined" ? window :
  {};

const API = () =>
  ((rootScope.VisionConfig?.API_BASE) ??
   "https://xwalletv1dot2.agedotcom.workers.dev").replace(/\/$/, "");

// Safe JSON fetch helper with readable diagnostics
async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}\n${text.slice(0,200)}…`);
  try { return /json/.test(ct) ? JSON.parse(text) : JSON.parse(text); }
  catch { throw new Error(`Invalid JSON from ${url}: ${text.slice(0,200)}…`); }
}

// --- uses your OFAC endpoint instead of /sanctions ---
async function ofacCheck(addr, network) {
  const url = `${API()}/ofac?address=${encodeURIComponent(addr)}&network=${network}`;
  return await fetchJSON(url, { credentials: "omit" });
}

export const RiskAdapters = {
  evm: {
    async getAddressSummary(addr, { network } = {}) {
      network = network || "eth";
      const qs = new URLSearchParams({
        module: "account",
        action: "txlist",
        address: addr,
        startblock: "0",
        endblock: "99999999",
        page: "1",
        offset: "100",
        sort: "asc",
        network,
      });
      const url = `${API()}/etherscan?${qs.toString()}`;
      const res = await fetchJSON(url);
      const txs = Array.isArray(res.result) ? res.result : [];

      let ageDays = null,
          fanInZ = 0,
          fanOutZ = 0,
          mixerTaint = 0,
          category = "wallet";

      if (txs.length) {
        const firstTs = Number(txs[0].timeStamp || 0) * 1000;
        if (firstTs)
          ageDays = Math.max(
            0,
            (Date.now() - firstTs) / (1000 * 60 * 60 * 24)
          );
        const latest = txs.slice(-50);
        const senders = new Set(),
          receivers = new Set();
        for (const t of latest) {
          if (t.from) senders.add(t.from.toLowerCase());
          if (t.to) receivers.add(String(t.to || "").toLowerCase());
        }
        fanInZ = (senders.size - 5) / 3;
        fanOutZ = (receivers.size - 5) / 3;
      }

      const s = await ofacCheck(addr, network);
      const sanctionHits = !!s?.hit;

      if (txs.length) {
        const heuristic = txs
          .slice(-100)
          .some((t) =>
            /binance|kraken|coinbase|exchange/i.test(
              `${t.toTag || ""}${t.fromTag || ""}${t.functionName || ""}`
            )
          );
        if (heuristic) category = "exchange_unverified";
      }

      return { ageDays, category, sanctionHits, mixerTaint, fanInZ, fanOutZ };
    },

    async getLocalGraphStats(addr, { network } = {}) {
      network = network || "eth";
      const qs = new URLSearchParams({
        module: "account",
        action: "txlist",
        address: addr,
        startblock: "0",
        endblock: "99999999",
        page: "1",
        offset: "100",
        sort: "desc",
        network,
      });
      const url = `${API()}/etherscan?${qs.toString()}`;
      const res = await fetchJSON(url);
      const txs = Array.isArray(res.result) ? res.result : [];

      const neigh = new Set();
      for (const t of txs) {
        if (t.from) neigh.add(t.from.toLowerCase());
        if (t.to) neigh.add(String(t.to || "").toLowerCase());
      }
      neigh.delete(addr.toLowerCase());
      const neighbors = Array.from(neigh);

      let riskyCount = 0;
      for (const n of neighbors) {
        const s = await ofacCheck(n, network);
        if (s?.hit) riskyCount++;
      }

      const riskyNeighborRatio = neighbors.length
        ? riskyCount / neighbors.length
        : 0;
      const degree = neighbors.length;
      const centralityZ = (degree - 8) / 4;
      const riskyFlowRatio = riskyNeighborRatio * 0.7;

      return {
        riskyNeighborRatio,
        shortestPathToSanctioned: 3,
        centralityZ,
        riskyFlowRatio,
      };
    },

    async getAnomalySeries(addr, { network } = {}) {
      network = network || "eth";
      const qs = new URLSearchParams({
        module: "account",
        action: "txlist",
        address: addr,
        startblock: "0",
        endblock: "99999999",
        page: "1",
        offset: "100",
        sort: "desc",
        network,
      });
      const url = `${API()}/etherscan?${qs.toString()}`;
      const res = await fetchJSON(url);
      const txs = Array.isArray(res.result) ? res.result : [];

      const byDay = new Map();
      for (const t of txs) {
        const ts = new Date((Number(t.timeStamp || 0)) * 1000);
        const day = ts.toISOString().slice(0, 10);
        byDay.set(day, (byDay.get(day) || 0) + 1);
      }
      const counts = Array.from(byDay.values());
      const mean = counts.reduce((a, b) => a + b, 0) / (counts.length || 1);
      const last = counts[counts.length - 1] || 0;
      const burstZ = (last - mean) / Math.max(1, Math.sqrt(mean || 1));
      return { burstZ };
    },
  },
};
