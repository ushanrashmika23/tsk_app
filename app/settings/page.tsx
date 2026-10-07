export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="pt-4 pb-2">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
      </header>

      <div className="bg-white dark:bg-zinc-800 rounded-2xl border border-gray-100 dark:border-zinc-800/50 p-6 flex flex-col gap-6">
        <div>
          <h2 className="font-semibold text-lg mb-2">Theme</h2>
          <p className="text-sm text-gray-500 mb-4">Select your preferred appearance.</p>
          <div className="flex gap-3">
            <button className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-zinc-700 text-sm font-medium">Light</button>
            <button className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-zinc-700 text-sm font-medium">Dark</button>
            <button className="px-4 py-2 rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-sm font-medium">System</button>
          </div>
        </div>

        <hr className="border-gray-100 dark:border-zinc-700" />

        <div>
          <h2 className="font-semibold text-lg mb-2">Default Priority</h2>
          <p className="text-sm text-gray-500 mb-4">Default priority for new tasks.</p>
          <div className="flex gap-3">
            <button className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-zinc-700 text-sm font-medium">Low</button>
            <button className="px-4 py-2 rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-sm font-medium">Medium</button>
            <button className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-zinc-700 text-sm font-medium">High</button>
          </div>
        </div>
      </div>
    </div>
  );
}
