<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '$lib/utils/api';
	import { user } from '$lib/stores/auth';

	onMount(async () => {
		try {
			const res = await api<{ user: any }>('/api/auth/me');
			user.set(res.user);
			await goto('/app');
		} catch {
			await goto('/login');
		}
	});
</script>

<div class="flex items-center justify-center min-h-screen">
	<span class="inline-block w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin" style="color: var(--wr-primary)"></span>
</div>
