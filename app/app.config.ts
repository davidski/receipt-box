const inputBase = 'w-full min-h-11 px-3.5 py-2 text-base rounded-(--radius-input) border border-(--line-control) bg-(--surface-strong) text-(--ink) focus:border-(--accent) focus:outline-[3px] focus:outline-(--focus-ring) focus:outline-offset-2 focus:shadow-none transition-[border-color,box-shadow] duration-150'

const inputTextBase = { fixed: false, class: 'md:text-base' }

export default defineAppConfig({
  ui: {
    // Solid primary fills use the deeper accent fill so dark mode keeps a rich petrol; --ui-primary stays the AAA text accent.
    button: {
      compoundVariants: [{
        color: 'primary',
        variant: 'solid',
        class: 'text-(--on-accent-fill) bg-(--accent-fill) hover:bg-(--accent-fill-hover) active:bg-(--accent-fill-hover) disabled:bg-(--accent-fill) aria-disabled:bg-(--accent-fill)'
      }]
    },
    // Nuxt UI shrinks input text to text-sm from md up; keep text-base at every width to match body text.
    input: { slots: { base: inputBase }, compoundVariants: [inputTextBase] },
    inputMenu: { slots: { base: inputBase }, compoundVariants: [inputTextBase] },
    textarea: { slots: { base: inputBase }, compoundVariants: [inputTextBase] },
    select: { slots: { base: inputBase }, compoundVariants: [inputTextBase] },
    selectMenu: { slots: { base: inputBase }, compoundVariants: [inputTextBase] },
    colors: {
      primary: 'teal',
      success: 'emerald',
      warning: 'amber',
      error: 'red',
      neutral: 'slate'
    }
  }
})
