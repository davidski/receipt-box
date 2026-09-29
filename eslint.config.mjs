import typescriptParser from '@typescript-eslint/parser'
import tailwindcss from 'eslint-plugin-tailwindcss'
import vueParser from 'vue-eslint-parser'

export default [
  {
    ...tailwindcss.configs.recommended,
    files: ['app/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: typescriptParser }
    },
    settings: {
      tailwindcss: {
        cssConfigPath: './app/assets/css/main.css'
      }
    },
    rules: {
      // This app intentionally combines Tailwind utilities with classes styled in main.css.
      'tailwindcss/no-custom-classname': 'off'
    }
  }
]
