/** Live weather via Open-Meteo; fallback if network blocked. */
export async function getWeather(city: string): Promise<string> {
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!geoRes.ok) throw new Error(`geocoding HTTP ${geoRes.status}`);
    const geo = (await geoRes.json()) as {
      results?: { name: string; country?: string; latitude: number; longitude: number }[];
    };
    const place = geo.results?.[0];
    if (!place) return JSON.stringify({ error: `Could not find city: ${city}` });

    const wxRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,weather_code`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!wxRes.ok) throw new Error(`forecast HTTP ${wxRes.status}`);
    const wx = (await wxRes.json()) as {
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
        weather_code?: number;
      };
    };

    return JSON.stringify({
      place: `${place.name}${place.country ? ", " + place.country : ""}`,
      temp_c: wx.current?.temperature_2m ?? "unknown",
      humidity: wx.current?.relative_humidity_2m ?? "unknown",
      weather_code: wx.current?.weather_code ?? "unknown",
      note: "weather_code: 0=clear, 1-3=clouds, 61-67=rain, 71-77=snow",
      source: "open-meteo",
    });
  } catch (e) {
    return JSON.stringify({
      place: city,
      temp_c: 28,
      description: "Partly cloudy (fallback — live API unreachable)",
      humidity: 40,
      source: "fallback",
      error: (e as Error).message,
    });
  }
}
