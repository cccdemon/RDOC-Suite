import os from "node:os";
import { getEnv } from "../config/env.js";
import { rooms } from "./rooms.js";

type CpuSample = { at: number; usage: NodeJS.CpuUsage };
let lastCpuSample: CpuSample | null = null;

export type BandwidthMetrics = {
  source: "livekit_prometheus" | "unavailable";
  totalBytesIn: number | null;
  totalBytesOut: number | null;
  bitrateIn: number | null;
  bitrateOut: number | null;
  error?: string;
};

export type MonitoringSnapshot = {
  generatedAt: string;
  uptimeSeconds: number;
  activeRooms: number;
  activeCommanders: number;
  speakingCommanders: number;
  system: {
    cpuPercent: number | null;
    memory: {
      processRssBytes: number;
      processHeapUsedBytes: number;
      processHeapTotalBytes: number;
      systemUsedBytes: number;
      systemTotalBytes: number;
    };
  };
  bandwidth: BandwidthMetrics;
  rooms: Array<{
    roomId: string;
    activeCommanders: number;
    speakingCommanders: number;
    commanders: Array<{ userId: string; displayName?: string; speaking: boolean }>;
  }>;
};

export async function monitoringSnapshot(): Promise<MonitoringSnapshot> {
  const metrics = rooms.globalMetrics();
  const memory = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  return {
    generatedAt: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    activeRooms: metrics.activeRooms,
    activeCommanders: metrics.activeCommanders,
    speakingCommanders: metrics.speakingCommanders,
    system: {
      cpuPercent: sampleCpuPercent(),
      memory: {
        processRssBytes: memory.rss,
        processHeapUsedBytes: memory.heapUsed,
        processHeapTotalBytes: memory.heapTotal,
        systemUsedBytes: totalMem - freeMem,
        systemTotalBytes: totalMem,
      },
    },
    bandwidth: await fetchLivekitBandwidth(),
    rooms: metrics.rooms,
  };
}

function sampleCpuPercent(): number | null {
  const current: CpuSample = { at: Date.now(), usage: process.cpuUsage() };
  const previous = lastCpuSample;
  lastCpuSample = current;
  if (!previous) return null;
  const elapsedMicros = (current.at - previous.at) * 1000;
  if (elapsedMicros <= 0) return null;
  const usage = process.cpuUsage(previous.usage);
  const percent =
    ((usage.user + usage.system) / (elapsedMicros * Math.max(1, os.cpus().length))) * 100;
  return Math.round(percent * 10) / 10;
}

async function fetchLivekitBandwidth(): Promise<BandwidthMetrics> {
  const url = livekitMetricsUrl();
  if (!url) return unavailable();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return unavailable(`metrics endpoint returned ${res.status}`);
    return parsePrometheusBandwidth(await res.text());
  } catch (err) {
    return unavailable(String(err));
  }
}

function livekitMetricsUrl(): string | null {
  const env = getEnv();
  if (env.LIVEKIT_PROMETHEUS_URL) return env.LIVEKIT_PROMETHEUS_URL;
  try {
    const url = new URL(env.LIVEKIT_URL);
    if (url.protocol === "ws:") url.protocol = "http:";
    else if (url.protocol === "wss:") url.protocol = "https:";
    else if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.pathname = "/metrics";
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

function unavailable(error?: string): BandwidthMetrics {
  return { source: "unavailable", totalBytesIn: null, totalBytesOut: null, bitrateIn: null, bitrateOut: null, error };
}

function parsePrometheusBandwidth(text: string): BandwidthMetrics {
  const BYTES_IN  = new Set(["livekit_bytes_received", "livekit_node_bytes_in_total",  "livekit_node_bytes_in"]);
  const BYTES_OUT = new Set(["livekit_bytes_sent",     "livekit_node_bytes_out_total", "livekit_node_bytes_out"]);
  const RATE_IN   = new Set(["livekit_node_bitrate_in"]);
  const RATE_OUT  = new Set(["livekit_node_bitrate_out"]);

  let totalBytesIn: number | null = null;
  let totalBytesOut: number | null = null;
  let bitrateIn: number | null = null;
  let bitrateOut: number | null = null;

  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || line.includes("{")) continue;
    const space = line.indexOf(" ");
    if (space < 0) continue;
    const name = line.slice(0, space);
    const value = Number(line.slice(space + 1));
    if (!Number.isFinite(value)) continue;
    if (BYTES_IN.has(name))  totalBytesIn  = value;
    if (BYTES_OUT.has(name)) totalBytesOut = value;
    if (RATE_IN.has(name))   bitrateIn     = value;
    if (RATE_OUT.has(name))  bitrateOut    = value;
  }

  return {
    source: "livekit_prometheus",
    totalBytesIn:  totalBytesIn  !== null ? Math.round(totalBytesIn)  : null,
    totalBytesOut: totalBytesOut !== null ? Math.round(totalBytesOut) : null,
    bitrateIn:     bitrateIn     !== null ? Math.round(bitrateIn)     : null,
    bitrateOut:    bitrateOut    !== null ? Math.round(bitrateOut)    : null,
  };
}
