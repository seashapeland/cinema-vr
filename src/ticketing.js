import * as THREE from 'three';
import { loadCinemaConfig } from './cinemaConfig.js';

function makeTexture(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return { canvas, context, texture };
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function fitTitle(context, value, maxWidth, initialSize, weight = 800) {
  let size = initialSize;
  do {
    context.font = `${weight} ${size}px Arial, "Microsoft YaHei", sans-serif`;
    if (context.measureText(value).width <= maxWidth) return size;
    size -= 2;
  } while (size > 24);
  return size;
}

function drawImageCover(context, image, x, y, width, height) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.naturalWidth - sourceWidth) / 2;
  const sourceY = (image.naturalHeight - sourceHeight) / 2;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function serialFromTime(now, movieIndex) {
  return `V07${String(movieIndex + 1).padStart(2, '0')}${String(now.getTime()).slice(-9)}`;
}

function drawPseudoBarcode(context, serial, x, y, width, height) {
  context.fillStyle = '#10202a';
  let cursor = x;
  let index = 0;
  while (cursor < x + width) {
    const code = serial.charCodeAt(index % serial.length);
    const bar = 2 + ((code + index * 7) % 5);
    if ((code + index) % 3 !== 0) context.fillRect(cursor, y, bar, height);
    cursor += bar + 2 + ((code + index * 3) % 3);
    index += 1;
  }
}

function drawPseudoQr(context, serial, x, y, size) {
  const cells = 21;
  const cell = size / cells;
  context.fillStyle = '#f5ecdd';
  context.fillRect(x, y, size, size);
  for (let row = 0; row < cells; row++) {
    for (let column = 0; column < cells; column++) {
      const code = serial.charCodeAt((row * 3 + column * 5) % serial.length);
      const finder = (row < 7 && column < 7) || (row < 7 && column >= 14) || (row >= 14 && column < 7);
      const edge = finder && (row % 7 === 0 || column % 7 === 0 || row % 7 === 6 || column % 7 === 6);
      const center = finder && row % 7 >= 2 && row % 7 <= 4 && column % 7 >= 2 && column % 7 <= 4;
      if (edge || center || (!finder && (code + row * 11 + column * 17) % 7 < 3)) {
        context.fillStyle = '#10202a';
        context.fillRect(x + column * cell, y + row * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
  }
}

const fallbackMovies = [
  { id: 'last-orbit', name: 'LAST ORBIT', poster: '/lobby-media/posters/poster-01.svg', showtime: '19:30', hall: '01', seat: 'E08', price: '68.00' },
  { id: 'midnight-signal', name: 'MIDNIGHT SIGNAL', poster: '/lobby-media/posters/poster-02.svg', showtime: '20:10', hall: '01', seat: 'F10', price: '68.00' },
  { id: 'echo-garden', name: 'ECHO GARDEN', poster: '/lobby-media/posters/poster-03.svg', showtime: '21:00', hall: '01', seat: 'G12', price: '78.00' },
];

export function createTicketingSystem({ renderer }) {
  const screen = makeTexture(768, 1024);
  const ticket = makeTexture(1400, 520);
  screen.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  ticket.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const ticketMaterial = new THREE.MeshBasicMaterial({ map: ticket.texture, toneMapped: false, side: THREE.DoubleSide });
  const posterImages = new Map();
  let cinemaName = 'VELVET 07 CINEMA';
  let currency = '¥';
  let movies = fallbackMovies;
  let selectedIndex = 0;
  let hoverAction = null;
  let printedTicket = null;

  const selectedMovie = () => movies[selectedIndex] ?? fallbackMovies[0];

  const preloadPoster = (movie) => {
    if (!movie?.poster || posterImages.has(movie.poster)) return;
    const image = new Image();
    posterImages.set(movie.poster, image);
    image.addEventListener('load', () => drawKiosk());
    image.src = movie.poster;
  };

  const drawButton = (context, action, label, x, y, width, height, accent = false) => {
    const hovered = hoverAction === action;
    context.fillStyle = accent ? (hovered ? '#9ff0ff' : '#5dd5f1') : (hovered ? '#29475b' : '#182d3d');
    roundedRect(context, x, y, width, height, 18);
    context.fill();
    context.strokeStyle = accent ? '#c8f7ff' : '#36556a';
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = accent ? '#06131d' : '#e8f2f5';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '700 27px Arial, "Microsoft YaHei", sans-serif';
    context.fillText(label, x + width / 2, y + height / 2 + 1);
  };

  function drawKiosk() {
    const { context, canvas, texture } = screen;
    const movie = selectedMovie();
    const background = context.createLinearGradient(0, 0, 0, canvas.height);
    background.addColorStop(0, '#07131e');
    background.addColorStop(0.58, '#0d2638');
    background.addColorStop(1, '#07131d');
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#60d9f5';
    context.fillRect(0, 0, canvas.width, 8);
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#eff8fa';
    context.font = '800 38px Arial, "Microsoft YaHei", sans-serif';
    context.fillText('SELF-SERVICE TICKETS', 42, 66);
    context.fillStyle = '#75dff6';
    context.font = '600 17px Arial, "Microsoft YaHei", sans-serif';
    context.fillText(`${cinemaName}  /  SELECT A FILM`, 44, 97);

    context.fillStyle = '#09121a';
    roundedRect(context, 48, 132, 272, 406, 16);
    context.fill();
    const poster = posterImages.get(movie.poster);
    if (poster?.complete && poster.naturalWidth) {
      context.save();
      roundedRect(context, 58, 142, 252, 386, 12);
      context.clip();
      drawImageCover(context, poster, 58, 142, 252, 386);
      context.restore();
    } else {
      context.fillStyle = '#17374c';
      roundedRect(context, 58, 142, 252, 386, 12);
      context.fill();
      context.fillStyle = '#86def3';
      context.textAlign = 'center';
      context.font = '700 22px Arial, sans-serif';
      context.fillText('LOADING POSTER', 184, 340);
    }

    context.textAlign = 'left';
    context.fillStyle = '#75dff6';
    context.font = '700 18px Arial, "Microsoft YaHei", sans-serif';
    context.fillText(`FILM ${selectedIndex + 1} / ${movies.length}`, 352, 176);
    context.fillStyle = '#f6f3ea';
    fitTitle(context, movie.name, 356, 46);
    context.fillText(movie.name, 352, 238);
    context.fillStyle = '#9fb1bb';
    context.font = '600 17px Arial, "Microsoft YaHei", sans-serif';
    context.fillText('SHOWTIME', 352, 302);
    context.fillText('AUDITORIUM', 352, 384);
    context.fillText('RESERVED SEAT', 352, 466);
    context.fillStyle = '#ffffff';
    context.font = '800 42px Arial, "Microsoft YaHei", sans-serif';
    context.fillText(movie.showtime, 352, 346);
    context.fillText(movie.hall, 352, 428);
    context.fillText(movie.seat, 352, 510);

    context.strokeStyle = '#2c5268';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(48, 580);
    context.lineTo(720, 580);
    context.stroke();
    drawButton(context, 'previous', '‹', 54, 625, 108, 96);
    drawButton(context, 'next', '›', 606, 625, 108, 96);
    context.textAlign = 'center';
    context.fillStyle = '#d9e8ec';
    context.font = '650 21px Arial, "Microsoft YaHei", sans-serif';
    context.fillText(`${movie.showtime}  ·  HALL ${movie.hall}  ·  SEAT ${movie.seat}`, 384, 675);
    context.fillStyle = '#6f8998';
    context.font = '500 16px Arial, "Microsoft YaHei", sans-serif';
    context.fillText(`${currency}${movie.price}  /  SINGLE ADMISSION`, 384, 711);

    drawButton(context, 'print', printedTicket ? 'TICKET ALREADY ISSUED' : 'PRINT TICKET', 154, 780, 460, 104, true);
    if (printedTicket) {
      context.fillStyle = '#b7c9d0';
      context.font = '500 17px Arial, "Microsoft YaHei", sans-serif';
      context.fillText('Ticket in hand  /  H HIDE  /  R ENLARGE', 384, 914);
    }
    drawButton(context, 'exit', 'RETURN TO LOBBY', 246, 944, 276, 54);
    texture.needsUpdate = true;
  }

  function drawTicket(record) {
    const { context, canvas, texture } = ticket;
    const movie = record.movie;
    context.fillStyle = '#f2eadc';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#102631';
    context.fillRect(0, 0, 28, canvas.height);
    context.fillStyle = '#55cfe9';
    context.fillRect(28, 0, 10, canvas.height);
    context.fillStyle = '#102631';
    context.font = '800 28px Arial, "Microsoft YaHei", sans-serif';
    context.fillText(cinemaName, 76, 66);
    context.fillStyle = '#5c727d';
    context.font = '650 16px Arial, "Microsoft YaHei", sans-serif';
    context.fillText('ONE-TIME CINEMA ADMISSION', 78, 94);

    const poster = posterImages.get(movie.poster);
    if (poster?.complete && poster.naturalWidth) {
      context.save();
      roundedRect(context, 72, 124, 235, 326, 12);
      context.clip();
      drawImageCover(context, poster, 72, 124, 235, 326);
      context.restore();
    } else {
      context.fillStyle = '#17394a';
      roundedRect(context, 72, 124, 235, 326, 12);
      context.fill();
    }

    context.fillStyle = '#0d2029';
    fitTitle(context, movie.name, 710, 50);
    context.fillText(movie.name, 344, 155);
    context.fillStyle = '#6b7e86';
    context.font = '700 15px Arial, "Microsoft YaHei", sans-serif';
    context.fillText('DATE', 346, 218);
    context.fillText('SHOWTIME', 560, 218);
    context.fillText('AUDITORIUM', 770, 218);
    context.fillText('SEAT', 954, 218);
    context.fillStyle = '#102631';
    context.font = '800 30px Arial, "Microsoft YaHei", sans-serif';
    context.fillText(record.date, 346, 257);
    context.fillText(movie.showtime, 560, 257);
    context.fillText(movie.hall, 770, 257);
    context.fillText(movie.seat, 954, 257);
    context.fillStyle = '#6b7e86';
    context.font = '650 15px Arial, "Microsoft YaHei", sans-serif';
    context.fillText(`ISSUED ${record.issuedTime}`, 346, 312);
    context.fillText(`PRICE ${currency}${movie.price}`, 560, 312);
    context.fillText(`ORDER ${record.serial}`, 770, 312);
    drawPseudoBarcode(context, record.serial, 346, 350, 684, 62);
    context.fillStyle = '#526871';
    context.font = '500 13px ui-monospace, Consolas, monospace';
    context.fillText(record.serial, 346, 438);

    context.strokeStyle = '#9d9b91';
    context.lineWidth = 3;
    context.setLineDash([12, 10]);
    context.beginPath();
    context.moveTo(1110, 24);
    context.lineTo(1110, 496);
    context.stroke();
    context.setLineDash([]);
    drawPseudoQr(context, record.serial, 1152, 68, 180);
    context.fillStyle = '#102631';
    context.textAlign = 'center';
    context.font = '900 54px Arial, "Microsoft YaHei", sans-serif';
    context.fillText(movie.seat, 1242, 324);
    context.fillStyle = '#5d717a';
    context.font = '700 16px Arial, "Microsoft YaHei", sans-serif';
    context.fillText(`HALL ${movie.hall}  ·  ${movie.showtime}`, 1242, 365);
    context.fillText('ADMIT ONE', 1242, 414);
    context.textAlign = 'left';
    texture.needsUpdate = true;
  }

  const actionAtUv = (uv) => {
    if (!uv) return null;
    const x = uv.x * screen.canvas.width;
    const y = (1 - uv.y) * screen.canvas.height;
    if (x >= 54 && x <= 162 && y >= 625 && y <= 721) return 'previous';
    if (x >= 606 && x <= 714 && y >= 625 && y <= 721) return 'next';
    if (x >= 154 && x <= 614 && y >= 780 && y <= 884) return 'print';
    if (x >= 246 && x <= 522 && y >= 944 && y <= 998) return 'exit';
    return null;
  };

  const activate = (action) => {
    if (action === 'previous' || action === 'next') {
      const delta = action === 'previous' ? -1 : 1;
      selectedIndex = (selectedIndex + delta + movies.length) % movies.length;
      preloadPoster(selectedMovie());
      drawKiosk();
      return { type: 'selection', movie: selectedMovie() };
    }
    if (action === 'print') {
      if (printedTicket) return { type: 'already-issued', record: printedTicket };
      const now = new Date();
      printedTicket = {
        movie: { ...selectedMovie() },
        serial: serialFromTime(now, selectedIndex),
        date: new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now),
        issuedTime: new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now),
      };
      drawTicket(printedTicket);
      drawKiosk();
      return { type: 'printed', record: printedTicket };
    }
    if (action === 'exit') return { type: 'exit' };
    return { type: 'none' };
  };

  const loadConfig = async (url = '/lobby-media/ticketing.json') => {
    try {
      const [response, sharedConfig] = await Promise.all([
        fetch(url, { cache: 'no-store' }),
        loadCinemaConfig(),
      ]);
      if (!response.ok) throw new Error(`Ticket config ${response.status}`);
      const config = await response.json();
      const configuredMovies = Array.isArray(config.movies) ? config.movies.filter((movie) => movie?.name && movie?.poster) : [];
      if (configuredMovies.length) movies = configuredMovies.map((movie, index) => ({
        id: movie.id || `movie-${index + 1}`,
        name: String(movie.name),
        poster: String(movie.poster),
        showtime: String(movie.showtime || '19:30'),
        hall: String(movie.hall || '01'),
        seat: String(movie.seat || 'E08'),
        price: String(movie.price || '68.00'),
      }));
      cinemaName = String(sharedConfig.ticketCinemaName || sharedConfig.cinemaName || config.cinemaName || cinemaName);
      currency = String(config.currency || currency);
      selectedIndex = 0;
      movies.forEach(preloadPoster);
      drawKiosk();
    } catch {
      movies.forEach(preloadPoster);
      drawKiosk();
    }
  };

  movies.forEach(preloadPoster);
  drawKiosk();

  return {
    screenTexture: screen.texture,
    ticketMaterial,
    loadConfig,
    actionAtUv,
    activate,
    setHover(action) {
      if (hoverAction === action) return;
      hoverAction = action;
      drawKiosk();
    },
    clear() {
      printedTicket = null;
      hoverAction = null;
      drawKiosk();
    },
    hasTicket() {
      return Boolean(printedTicket);
    },
    getRecord() {
      return printedTicket;
    },
  };
}
