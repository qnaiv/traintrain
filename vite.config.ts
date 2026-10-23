import { defineConfig } from 'vite';

// GitHub Pages では https://qnaiv.github.io/traintrain/ で配信される
export default defineConfig({
  base: '/traintrain/',
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        // 試作：満員電車シェイク
        shake: 'shake.html',
      },
    },
  },
});
