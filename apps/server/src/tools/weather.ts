// Clima — temperatura e condicao do tempo, sem chave de API.
//
// Fonte: Open-Meteo (gratis, sem cadastro). A localizacao vem das coordenadas
// que o navegador manda (mais precisa); se nao vier, cai para geolocalizacao
// por IP (ip-api.com). O nome da cidade sai do reverse-geocode do BigDataCloud
// (gratis, sem chave). Node 20+ ja tem fetch global.

interface CondicaoTempo {
  txt: string;
  emoji: string;
}

const codeMap: Record<number, CondicaoTempo> = {
  0: { txt: 'Céu limpo', emoji: '☀️' },
  1: { txt: 'Predominantemente limpo', emoji: '🌤️' },
  2: { txt: 'Parcialmente nublado', emoji: '⛅' },
  3: { txt: 'Nublado', emoji: '☁️' },
  45: { txt: 'Neblina', emoji: '🌫️' },
  48: { txt: 'Neblina com geada', emoji: '🌫️' },
  51: { txt: 'Garoa fraca', emoji: '🌦️' },
  53: { txt: 'Garoa', emoji: '🌦️' },
  55: { txt: 'Garoa forte', emoji: '🌧️' },
  56: { txt: 'Garoa congelante', emoji: '🌧️' },
  57: { txt: 'Garoa congelante forte', emoji: '🌧️' },
  61: { txt: 'Chuva fraca', emoji: '🌦️' },
  63: { txt: 'Chuva', emoji: '🌧️' },
  65: { txt: 'Chuva forte', emoji: '🌧️' },
  66: { txt: 'Chuva congelante', emoji: '🌧️' },
  67: { txt: 'Chuva congelante forte', emoji: '🌧️' },
  71: { txt: 'Neve fraca', emoji: '🌨️' },
  73: { txt: 'Neve', emoji: '🌨️' },
  75: { txt: 'Neve forte', emoji: '❄️' },
  77: { txt: 'Grãos de neve', emoji: '🌨️' },
  80: { txt: 'Pancadas de chuva', emoji: '🌦️' },
  81: { txt: 'Pancadas fortes', emoji: '🌧️' },
  82: { txt: 'Temporal de chuva', emoji: '⛈️' },
  85: { txt: 'Pancadas de neve', emoji: '🌨️' },
  86: { txt: 'Neve intensa', emoji: '❄️' },
  95: { txt: 'Tempestade', emoji: '⛈️' },
  96: { txt: 'Tempestade com granizo', emoji: '⛈️' },
  99: { txt: 'Tempestade forte com granizo', emoji: '⛈️' },
};

function describe(code: number): CondicaoTempo {
  return codeMap[code] || { txt: 'Tempo indefinido', emoji: '🌡️' };
}

interface LocIp {
  lat: number;
  lon: number;
  city: string;
  region: string;
}

async function locateByIp(): Promise<LocIp | null> {
  try {
    const r = await fetch('http://ip-api.com/json/?fields=status,city,regionName,lat,lon', {
      signal: AbortSignal.timeout(6000),
    });
    const d: any = await r.json();
    if (d.status === 'success') {
      return { lat: d.lat, lon: d.lon, city: d.city, region: d.regionName };
    }
  } catch {
    /* segue sem localizacao por IP */
  }
  return null;
}

async function cityName(lat: number, lon: number): Promise<string | null> {
  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=pt`,
      { signal: AbortSignal.timeout(6000) }
    );
    const d: any = await r.json();
    return d.city || d.locality || d.principalSubdivision || null;
  } catch {
    return null;
  }
}

export interface Coords {
  lat?: number;
  lon?: number;
}

/** Busca o clima atual. `coords` são as coordenadas do navegador (opcional). */
export async function getWeather({ lat, lon }: Coords = {}) {
  let city: string | null = null;
  let region: string | null = null;

  if (lat == null || lon == null) {
    const loc = await locateByIp();
    if (!loc) throw new Error('Não consegui descobrir sua localização.');
    ({ lat, lon, city, region } = loc);
  }

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day' +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&timezone=auto';

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('Serviço de clima indisponível.');
  const data: any = await res.json();

  const cur = data.current || {};
  const daily = data.daily || {};
  const cond = describe(cur.weather_code);
  if (!city) city = await cityName(lat, lon);

  return {
    city: city || 'Sua região',
    region: region || null,
    temp: Math.round(cur.temperature_2m),
    feelsLike: Math.round(cur.apparent_temperature),
    humidity: cur.relative_humidity_2m,
    wind: Math.round(cur.wind_speed_10m),
    isDay: cur.is_day === 1,
    code: cur.weather_code,
    description: cond.txt,
    emoji: cond.emoji,
    max: Math.round(daily.temperature_2m_max?.[0]),
    min: Math.round(daily.temperature_2m_min?.[0]),
    rainChance: daily.precipitation_probability_max?.[0] ?? null,
  };
}

/** Resumo curto em texto, para o Shadow falar. */
export async function getWeatherSummary(coords?: Coords): Promise<string> {
  const w = await getWeather(coords);
  let s = `Em ${w.city} está ${w.temp} graus, ${w.description.toLowerCase()}, sensação de ${w.feelsLike}. Máxima de ${w.max} e mínima de ${w.min}.`;
  if (w.rainChance != null) s += ` Chance de chuva de ${w.rainChance}%.`;
  return s;
}
