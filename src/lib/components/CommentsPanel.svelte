<script lang="ts">
  import type { UserRef } from '../types';
  import { comments, addComment, deleteComment } from '../stores/board';

  export let currentUser: UserRef;
  export let isEditor = false;
  let newText = '';

  function handleAdd() {
    const t = newText.trim();
    if (!t) return;
    addComment(t, currentUser);
    newText = '';
  }
</script>

<div style="display:flex; flex-direction:column; min-width:0; height:100%;">
  <div style="padding:12px; border-bottom:1px solid var(--color-border); display:flex; gap:8px; align-items:flex-start;">
    <textarea rows="3" placeholder="Add a comment..." bind:value={newText} style="flex:1; resize: vertical;"></textarea>
    <button on:click={handleAdd} disabled={!isEditor}>Add</button>
  </div>
  <div style="overflow:auto; padding:8px; display:flex; flex-direction:column; gap:8px;">
    {#each $comments as c (c.id)}
      <div style="background:#fff; border:1px solid var(--color-border); border-radius:8px; padding:8px;">
        <div style="font-size:12px; color:#666; display:flex; justify-content:space-between;">
          <span>{new Date(c.createdAt).toLocaleString()}</span>
          <button style="font-size:12px;" on:click={() => deleteComment(c.id)} disabled={!isEditor}>Delete</button>
        </div>
        <div style="white-space:pre-wrap; margin-top:6px; color:#000;">{c.text}</div>
      </div>
    {/each}
    {#if $comments.length === 0}
      <div style="padding:12px; color:#777;">No comments yet.</div>
    {/if}
  </div>
</div>

