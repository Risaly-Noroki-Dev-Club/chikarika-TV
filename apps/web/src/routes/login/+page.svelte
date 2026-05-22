<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '$lib/utils/api';
	import { user } from '$lib/stores/auth';

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let isLoading = $state(false);

	let canSubmit = $derived(email.trim() !== '' && password !== '' && !isLoading);

	async function handleLogin(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		isLoading = true;

		try {
			const res = await api<{ user: any }>('/api/auth/login', {
				method: 'POST',
				body: JSON.stringify({ email: email.trim(), password }),
			});
			user.set(res.user);
			await goto('/app');
		} catch (err: any) {
			error = err.message || '登录失败，请重试';
		} finally {
			isLoading = false;
		}
	}
</script>

<div class="flex items-center justify-center min-h-screen px-4">
	<div class="wr-card wr-fade-in w-full max-w-[400px] p-8">
		<div class="text-center mb-8">
			<h1 class="text-2xl font-bold" style="color: var(--wr-primary)">chikarika-TV</h1>
			<p class="mt-2 text-sm" style="color: var(--wr-text-medium)">和朋友一起看电影</p>
		</div>

		<form onsubmit={handleLogin} class="flex flex-col gap-5">
			{#if error}
				<div class="rounded-md px-4 py-3 text-sm" style="background: rgba(255, 180, 171, 0.1); color: var(--wr-error)">
					{error}
				</div>
			{/if}

			<div>
				<label for="email" class="wr-label">邮箱</label>
				<input
					id="email"
					type="email"
					class="wr-input"
					placeholder="you@example.com"
					bind:value={email}
					disabled={isLoading}
					autocomplete="email"
				/>
			</div>

			<div>
				<label for="password" class="wr-label">密码</label>
				<input
					id="password"
					type="password"
					class="wr-input"
					placeholder="••••••••"
					bind:value={password}
					disabled={isLoading}
					autocomplete="current-password"
				/>
			</div>

			<button
				type="submit"
				class="wr-btn wr-btn-primary w-full mt-2"
				disabled={!canSubmit}
			>
				{#if isLoading}
					<span class="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
					登录中...
				{:else}
					登录
				{/if}
			</button>
		</form>

		<p class="text-center mt-6 text-sm" style="color: var(--wr-text-medium)">
			没有账号？<a href="/register" class="font-medium hover:underline" style="color: var(--wr-primary)">注册</a>
		</p>
	</div>
</div>
