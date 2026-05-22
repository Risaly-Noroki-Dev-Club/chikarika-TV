<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '$lib/utils/api';
	import { user } from '$lib/stores/auth';

	let displayName = $state('');
	let email = $state('');
	let password = $state('');
	let error = $state('');
	let isLoading = $state(false);

	let canSubmit = $derived(
		displayName.trim() !== '' && email.trim() !== '' && password.length >= 8 && !isLoading
	);

	async function handleRegister(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		isLoading = true;

		try {
			const res = await api<{ user: any }>('/api/auth/register', {
				method: 'POST',
				body: JSON.stringify({
					displayName: displayName.trim(),
					email: email.trim(),
					password,
				}),
			});
			user.set(res.user);
			await goto('/app');
		} catch (err: any) {
			error = err.message || '注册失败，请重试';
		} finally {
			isLoading = false;
		}
	}
</script>

<div class="flex items-center justify-center min-h-screen px-4">
	<div class="wr-card wr-fade-in w-full max-w-[400px] p-8">
		<div class="text-center mb-8">
			<h1 class="text-2xl font-bold" style="color: var(--wr-primary)">chikarika-TV</h1>
			<p class="mt-2 text-sm" style="color: var(--wr-text-medium)">创建你的账号</p>
		</div>

		<form onsubmit={handleRegister} class="flex flex-col gap-5">
			{#if error}
				<div class="rounded-md px-4 py-3 text-sm" style="background: rgba(255, 180, 171, 0.1); color: var(--wr-error)">
					{error}
				</div>
			{/if}

			<div>
				<label for="displayName" class="wr-label">显示名称</label>
				<input
					id="displayName"
					type="text"
					class="wr-input"
					placeholder="你的昵称"
					bind:value={displayName}
					disabled={isLoading}
					autocomplete="name"
				/>
			</div>

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
					placeholder="至少 8 个字符"
					bind:value={password}
					disabled={isLoading}
					autocomplete="new-password"
				/>
				<p class="mt-1 text-xs" style="color: var(--wr-text-disabled)">
					{#if password.length > 0 && password.length < 8}
						还需要 {8 - password.length} 个字符
					{:else}
						至少 8 个字符
					{/if}
				</p>
			</div>

			<button
				type="submit"
				class="wr-btn wr-btn-primary w-full mt-2"
				disabled={!canSubmit}
			>
				{#if isLoading}
					<span class="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
					注册中...
				{:else}
					注册
				{/if}
			</button>
		</form>

		<p class="text-center mt-6 text-sm" style="color: var(--wr-text-medium)">
			已有账号？<a href="/login" class="font-medium hover:underline" style="color: var(--wr-primary)">登录</a>
		</p>
	</div>
</div>
