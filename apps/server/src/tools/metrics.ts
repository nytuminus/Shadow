// Monitor do sistema — coleta as metricas do PC para o painel do Shadow.
//
// Divisao em dois grupos por custo:
//   - BARATO (modulo os): CPU%, RAM, uptime. Lido a cada chamada.
//   - CARO (PowerShell/nvidia-smi): temperatura, GPU, disco, bateria. Roda em
//     processos externos (~200-500ms), entao fica em cache por alguns segundos.
//
// Nada aqui derruba a rota: se um coletor falhar, o campo vem null e o painel
// mostra "n/d". Temperatura de CPU raramente esta disponivel no Windows sem um
// driver dedicado (LibreHardwareMonitor); por isso e best-effort.

import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// ---------- CPU % (amostragem entre chamadas) ----------
interface CpuSample {
  idle: number;
  total: number;
}

function sampleCpu(): CpuSample {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    for (const t of Object.values(c.times)) total += t;
    idle += c.times.idle;
  }
  return { idle, total };
}

let lastCpu = sampleCpu();

function cpuUsagePercent(): number {
  const now = sampleCpu();
  const idleDelta = now.idle - lastCpu.idle;
  const totalDelta = now.total - lastCpu.total;
  lastCpu = now;
  if (totalDelta <= 0) return 0;
  const usage = (1 - idleDelta / totalDelta) * 100;
  return Math.max(0, Math.min(100, Math.round(usage)));
}

// ---------- Coletores caros (com cache) ----------
async function runPS(cmd: string): Promise<string> {
  const { stdout } = await execAsync(
    `powershell -NoProfile -NonInteractive -Command "${cmd}"`,
    { windowsHide: true, timeout: 8000 }
  );
  return stdout.trim();
}

interface GpuInfo {
  name: string;
  temp: number;
  util: number;
  memUsedMB: number;
  memTotalMB: number;
}

async function readGpu(): Promise<GpuInfo | null> {
  try {
    const out = await execAsync(
      'nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits',
      { windowsHide: true, timeout: 8000 }
    );
    const line = out.stdout.trim().split('\n')[0];
    if (!line) return null;
    const [name, temp, util, memUsed, memTotal] = line.split(',').map((s) => s.trim());
    return {
      name: name!,
      temp: Number(temp),
      util: Number(util),
      memUsedMB: Number(memUsed),
      memTotalMB: Number(memTotal),
    };
  } catch {
    return null; // sem GPU NVIDIA ou driver ausente
  }
}

async function readCpuTemp(): Promise<number | null> {
  try {
    const raw = await runPS(
      "(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop | Select-Object -First 1).CurrentTemperature"
    );
    const tenthsK = Number(raw);
    if (!tenthsK || Number.isNaN(tenthsK)) return null;
    // A WMI devolve decimos de Kelvin.
    const celsius = tenthsK / 10 - 273.15;
    if (celsius < 0 || celsius > 130) return null;
    return Math.round(celsius);
  } catch {
    return null; // "Sem suporte" na maioria dos desktops
  }
}

interface DiskInfo {
  usedGB: number;
  freeGB: number;
  totalGB: number;
  percent: number;
}

async function readDisk(): Promise<DiskInfo | null> {
  try {
    const raw = await runPS(
      "Get-PSDrive C | Select-Object @{n='used';e={[math]::Round($_.Used/1GB,1)}}, @{n='free';e={[math]::Round($_.Free/1GB,1)}} | ConvertTo-Json -Compress"
    );
    const d = JSON.parse(raw);
    const total = d.used + d.free;
    return {
      usedGB: d.used,
      freeGB: d.free,
      totalGB: Math.round(total * 10) / 10,
      percent: total > 0 ? Math.round((d.used / total) * 100) : 0,
    };
  } catch {
    return null;
  }
}

interface BatteryInfo {
  percent: number;
  charging: boolean;
}

async function readBattery(): Promise<BatteryInfo | null> {
  try {
    const raw = await runPS(
      "$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue; if ($b) { ('{0}|{1}' -f $b.EstimatedChargeRemaining, $b.BatteryStatus) } else { 'none' }"
    );
    if (!raw || raw === 'none') return null;
    const [pct, statusCode] = raw.split('|');
    return {
      percent: Number(pct),
      charging: Number(statusCode) === 2, // 2 = ligado na tomada
    };
  } catch {
    return null;
  }
}

interface SlowMetrics {
  gpu: GpuInfo | null;
  cpuTemp: number | null;
  disk: DiskInfo | null;
  battery: BatteryInfo | null;
}

let slowCache: SlowMetrics | null = null;
let slowAt = 0;
const SLOW_TTL = 4000;

async function getSlowMetrics(): Promise<SlowMetrics> {
  const now = Date.now();
  if (slowCache && now - slowAt < SLOW_TTL) return slowCache;
  const [gpu, cpuTemp, disk, battery] = await Promise.all([
    readGpu(),
    readCpuTemp(),
    readDisk(),
    readBattery(),
  ]);
  slowCache = { gpu, cpuTemp, disk, battery };
  slowAt = now;
  return slowCache;
}

// ---------- Metrica completa ----------
export async function getMetrics() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpus = os.cpus();

  const slow = await getSlowMetrics();

  return {
    time: new Date().toISOString(),
    host: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    uptimeSec: Math.round(os.uptime()),
    cpu: {
      model: cpus[0]?.model?.replace(/\s+/g, ' ').trim() || 'CPU',
      cores: cpus.length,
      usage: cpuUsagePercent(),
      temp: slow.cpuTemp, // pode ser null (n/d)
    },
    ram: {
      totalGB: Math.round((totalMem / 1024 ** 3) * 10) / 10,
      usedGB: Math.round((usedMem / 1024 ** 3) * 10) / 10,
      percent: Math.round((usedMem / totalMem) * 100),
    },
    gpu: slow.gpu,
    disk: slow.disk,
    battery: slow.battery,
  };
}

/** Resumo curto em texto, para o Shadow falar quando perguntam do PC. */
export async function getMetricsSummary(): Promise<string> {
  const m = await getMetrics();
  const partes = [`CPU em ${m.cpu.usage}%`, `memória em ${m.ram.percent}%`];
  if (m.cpu.temp != null) partes.push(`CPU a ${m.cpu.temp} graus`);
  if (m.gpu) partes.push(`GPU ${m.gpu.name} a ${m.gpu.temp} graus, uso ${m.gpu.util}%`);
  if (m.disk) partes.push(`disco C com ${m.disk.freeGB} gigas livres`);
  if (m.battery) partes.push(`bateria em ${m.battery.percent}%`);
  const horas = Math.floor(m.uptimeSec / 3600);
  partes.push(`ligado há ${horas} hora${horas === 1 ? '' : 's'}`);
  return partes.join(', ') + '.';
}
