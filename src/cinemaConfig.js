let cinemaConfigPromise;

export function loadCinemaConfig(url = '/lobby-media/config.json') {
  if (!cinemaConfigPromise) {
    cinemaConfigPromise = fetch(url, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`Cinema config ${response.status}`);
        return response.json();
      })
      .catch(() => ({}));
  }
  return cinemaConfigPromise;
}

export function resolveCinemaText(value, fallback, cinemaName = 'VELVET 07') {
  return String(value ?? fallback).replaceAll('{cinemaName}', cinemaName);
}
