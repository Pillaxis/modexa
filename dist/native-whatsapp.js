// Capacitor injects its bridge only in the packaged Android app.
export function nativeWhatsApp(win) {
  const bridge = win.Capacitor;
  if (bridge?.getPlatform?.() !== 'android') return null;
  // JSExport generates these methods for plugins registered by MainActivity.
  const plugin = bridge.Plugins?.ModexaWhatsApp;
  return async (files, isCurrent) => {
    if (!plugin) throw Error('Le partage WhatsApp est indisponible. Mettez MODEXA à jour.');
    if (files.length > 20 || files.some(file => file.size > 10485760) || files.reduce((sum, file) => sum + file.size, 0) > 104857600) {
      throw Error('Limite : 20 photos, 10 Mo par photo et 100 Mo par partage.');
    }
    const {session} = await plugin.begin();
    try {
      for (const file of files) {
        if (!isCurrent()) return;
        const data = await new Promise((resolve, reject) => {
          const reader = new win.FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(Error('Impossible de lire cette photo.'));
          reader.readAsDataURL(file);
        });
        if (!isCurrent()) return;
        await plugin.addPhoto({session, data, mime: file.type});
      }
      if (isCurrent()) await plugin.share({session});
    } finally {
      // A completed share retains its files natively; unfinished copies are removed.
      await plugin.cancel({session});
    }
  };
}
