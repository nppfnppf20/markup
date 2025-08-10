<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';

  export let x = 0;
  export let y = 0;
  export let width = 240;
  export let height = 100;
  export let text = '';
  export let color = '#ffffff';
  export let fontSize = 16;
  export let isEditing = false;
  export let selected = false;

  const dispatch = createEventDispatcher<{
    save: { text: string };
    select: {};
    delete: {};
    resize: { width: number; height: number };
  }>();

  let textareaEl: HTMLTextAreaElement | null = null;
  let editingValue = text;
  let isResizing = false;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let startWidth = 0;
  let startHeight = 0;

  onMount(() => {
    if (isEditing && textareaEl) textareaEl.focus();
  });

  $: if (isEditing) editingValue = text;

  function onKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      dispatch('save', { text: editingValue.trim() });
    }
  }

  function onBlur() {
    dispatch('save', { text: editingValue.trim() });
  }

  function onResizeStart(e: PointerEvent) {
    e.stopPropagation();
    isResizing = true;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    startWidth = width;
    startHeight = height;
    
    const svg = (e.target as Element).closest('svg');
    if (svg) {
      svg.addEventListener('pointermove', onResizeMove);
      svg.addEventListener('pointerup', onResizeEnd);
      svg.setPointerCapture(e.pointerId);
    }
  }

  function onResizeMove(e: PointerEvent) {
    if (!isResizing) return;
    
    const deltaX = e.clientX - resizeStartX;
    const deltaY = e.clientY - resizeStartY;
    
    const newWidth = Math.max(100, startWidth + deltaX);
    const newHeight = Math.max(40, startHeight + deltaY);
    
    dispatch('resize', { width: newWidth, height: newHeight });
  }

  function onResizeEnd(e: PointerEvent) {
    if (!isResizing) return;
    isResizing = false;
    
    const svg = (e.target as Element).closest('svg');
    if (svg) {
      svg.removeEventListener('pointermove', onResizeMove);
      svg.removeEventListener('pointerup', onResizeEnd);
      svg.releasePointerCapture(e.pointerId);
    }
  }
</script>

<g on:click|stopPropagation={() => dispatch('select')}>
  <rect x={x} y={y} width={width || 200} height={height || 60} fill="white" stroke={color} rx="6" ry="6" />
  <foreignObject x={x} y={y} width={width || 200} height={height || 60}>
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%; height:100%; display:flex;">
      {#if isEditing}
        <textarea
          bind:this={textareaEl}
          bind:value={editingValue}
          on:keydown={onKeydown}
          on:blur={onBlur}
          style="flex:1; resize:none; border:0; background: transparent; color: {color}; padding:6px; outline:none; font-size:{fontSize}px;"
        />
      {:else}
        <div style="flex:1; white-space:pre-wrap; color:{color}; font-size:{fontSize}px; padding:6px;">{text}</div>
      {/if}
    </div>
  </foreignObject>
  {#if selected}
    <!-- Delete button -->
    <g transform={`translate(${(x + (width || 200) - 14)}, ${(y) + 2})`} style="pointer-events: auto;">
      <rect x={-12} y={-2} width={16} height={16} rx="3" ry="3" fill="#d9534f" stroke="#a94442" style="cursor: pointer;" on:click|stopPropagation={() => dispatch('delete')} />
      <text x={-8} y={10} fill="#fff" font-size="12" font-family="sans-serif" style="cursor: pointer; user-select: none;" on:click|stopPropagation={() => dispatch('delete')}>
        ×
      </text>
    </g>
    <!-- Resize handle -->
    <g transform={`translate(${(x + (width || 200) - 8)}, ${(y + (height || 60) - 8)})`} style="pointer-events: auto;">
      <rect x={-6} y={-6} width={12} height={12} rx="2" ry="2" fill="#2f6feb" stroke="#1f4ed4" style="cursor: se-resize;" on:pointerdown={onResizeStart} />
      <path d="M -2,-2 L 2,2 M 0,-2 L 2,0 M -2,0 L 0,2" stroke="white" stroke-width="1" style="pointer-events: none;" />
    </g>
  {/if}
</g>