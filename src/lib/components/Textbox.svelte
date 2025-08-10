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
    resize: { width: number; height: number };
    move: { x: number; y: number };
    startEdit: {};
  }>();

  let textareaEl: HTMLTextAreaElement | null = null;
  let editingValue = text;
  let isResizing = false;
  let isDragging = false;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let dragStartX = 0;
  let dragStartY = 0;
  let startWidth = 0;
  let startHeight = 0;
  let startX = 0;
  let startY = 0;

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
    console.log('Textbox resize start triggered');
    e.stopPropagation();
    isResizing = true;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    startWidth = width || 200;
    startHeight = height || 60;
    
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

  function onDragStart(e: PointerEvent) {
    console.log('Textbox onDragStart called, isEditing:', isEditing, 'selected:', selected);
    if (isEditing) return; // Don't drag while editing
    e.stopPropagation();
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    startX = x;
    startY = y;
    
    const svg = (e.target as Element).closest('svg');
    if (svg) {
      svg.addEventListener('pointermove', onDragMove);
      svg.addEventListener('pointerup', onDragEnd);
      svg.setPointerCapture(e.pointerId);
    }
  }

  function onDragMove(e: PointerEvent) {
    if (!isDragging) return;
    
    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;
    
    // Only dispatch move if there's actual movement to avoid interference
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
      const newX = Math.max(0, startX + deltaX);
      const newY = Math.max(0, startY + deltaY);
      
      dispatch('move', { x: newX, y: newY });
    }
  }

  function onDragEnd(e: PointerEvent) {
    if (!isDragging) return;
    
    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;
    const totalMovement = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    isDragging = false;
    
    // If very little movement, treat it as a click for selection
    if (totalMovement < 5) {
      console.log('Textbox: Treating as click/select (movement:', totalMovement, ')');
      dispatch('select');
    }
    
    const svg = (e.target as Element).closest('svg');
    if (svg) {
      svg.removeEventListener('pointermove', onDragMove);
      svg.removeEventListener('pointerup', onDragEnd);
      svg.releasePointerCapture(e.pointerId);
    }
  }
</script>

<g>
  <rect 
    x={x} 
    y={y} 
    width={width || 200} 
    height={height || 60} 
    fill="white" 
    stroke={color} 
    rx="6" 
    ry="6" 
    style="cursor: {isEditing ? 'text' : 'move'};"
    on:pointerdown={onDragStart}
  />
  <foreignObject x={x} y={y} width={width || 200} height={height || 60} style="pointer-events: {isEditing ? 'auto' : 'none'};">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%; height:100%; display:flex; pointer-events: {isEditing ? 'auto' : 'none'};">
      {#if isEditing}
        <textarea
          bind:this={textareaEl}
          bind:value={editingValue}
          on:keydown={onKeydown}
          on:blur={onBlur}
          style="flex:1; resize:none; border:0; background: transparent; color: {color}; padding:6px; outline:none; font-size:{fontSize}px; pointer-events: auto;"
        />
      {:else}
        <div style="flex:1; white-space:pre-wrap; color:{color}; font-size:{fontSize}px; padding:6px; pointer-events: none;" on:pointerdown={onDragStart}>{text}</div>
      {/if}
    </div>
  </foreignObject>
</g>

<!-- Delete and resize buttons are now handled in MarkupBoard's UI layer -->