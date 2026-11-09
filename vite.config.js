import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        storefront: resolve(root, 'index.html'),
        account: resolve(root, 'account.html'),
        checkout: resolve(root, 'checkout.html'),
        admin: resolve(root, 'admin.html'),
      },
    },
  },
});
