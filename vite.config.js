import { defineConfig } from 'vite';

/**
 * La base del sito.
 *
 * In locale e su un dominio dedicato (Vercel, Netlify) il sito sta alla radice
 * e la base e' "/". Su GitHub Pages sta invece dentro una sottocartella col nome
 * del repository, e senza questa impostazione ogni file verrebbe cercato alla
 * radice del dominio: pagina bianca e una fila di 404.
 *
 * Il workflow di pubblicazione passa BASE_PATH; in locale non serve toccare
 * niente.
 */
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  build: { outDir: 'dist' },
});
