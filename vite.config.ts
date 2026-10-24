import { defineConfig } from 'vite';

// GitHub Pages では https://qnaiv.github.io/traintrain/ で配信される
export default defineConfig({
  base: '/traintrain/',
  build: {
    rollupOptions: {
      input: {
        // 本編：射出配達ラン
        main: 'index.html',
        // 旧URL（run.html）からトップへ転送
        run: 'run.html',
        // 旧版（v0.3 の停車ゲーム）と試作
        legacy: 'legacy.html',
        shake: 'shake.html',
        launch: 'launch.html',
      },
    },
  },
});
