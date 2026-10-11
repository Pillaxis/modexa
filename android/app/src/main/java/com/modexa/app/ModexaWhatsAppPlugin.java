package com.modexa.app;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.UUID;

/** Shares private cached copies to a specific WhatsApp package, without a chooser. */
@CapacitorPlugin(name = "ModexaWhatsApp")
public class ModexaWhatsAppPlugin extends Plugin {
    private final ArrayList<File> photos = new ArrayList<>();
    private String session;
    private long bytes;

    private File directory() { return new File(getContext().getCacheDir(), "whatsapp"); }

    @Override public void load() { prune(); }

    private void prune() {
        File[] files = directory().listFiles();
        if (files != null) for (File file : files) {
            if (file.isFile() && file.lastModified() < System.currentTimeMillis() - 86400000L) file.delete();
        }
    }

    private void discard() {
        for (File file : photos) file.delete();
        photos.clear(); session = null; bytes = 0;
    }

    private boolean valid(PluginCall call) {
        if (session != null && session.equals(call.getString("session"))) return true;
        call.reject("Le partage a expiré. Sélectionnez à nouveau vos photos."); return false;
    }

    @PluginMethod public void begin(PluginCall call) {
        discard(); prune();
        if (!directory().isDirectory() && !directory().mkdirs()) {
            call.reject("Impossible de préparer les photos sur cet appareil."); return;
        }
        session = UUID.randomUUID().toString();
        JSObject result = new JSObject(); result.put("session", session); call.resolve(result);
    }

    @PluginMethod public void addPhoto(PluginCall call) {
        if (!valid(call)) return;
        String mime = call.getString("mime", ""), data = call.getString("data", "");
        String extension;
        switch (mime) {
            case "image/jpeg": extension = ".jpg"; break;
            case "image/png": extension = ".png"; break;
            case "image/webp": extension = ".webp"; break;
            default: call.reject("Format de photo non pris en charge."); return;
        }
        if (photos.size() >= 20 || data.length() > 14000000) {
            call.reject("Limite : 20 photos, 10 Mo par photo."); return;
        }
        File file = new File(directory(), UUID.randomUUID().toString() + extension);
        try {
            byte[] decoded = Base64.decode(data, Base64.NO_WRAP);
            if (decoded.length == 0 || decoded.length > 10485760 || bytes + decoded.length > 104857600) {
                call.reject("Les photos sont trop volumineuses pour ce partage."); return;
            }
            try (FileOutputStream output = new FileOutputStream(file)) { output.write(decoded); }
            photos.add(file); bytes += decoded.length; call.resolve();
        } catch (Exception error) {
            file.delete(); call.reject("Impossible de préparer cette photo.");
        }
    }

    @PluginMethod public void cancel(PluginCall call) {
        if (session != null && session.equals(call.getString("session"))) discard();
        call.resolve();
    }

    @PluginMethod public void share(PluginCall call) {
        if (!valid(call)) return;
        if (photos.isEmpty()) { call.reject("Sélectionnez au moins une photo."); return; }
        ArrayList<Uri> uris = new ArrayList<>();
        for (File file : photos) uris.add(FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file));
        Intent intent = new Intent(uris.size() == 1 ? Intent.ACTION_SEND : Intent.ACTION_SEND_MULTIPLE);
        intent.setType("image/*");
        if (uris.size() == 1) intent.putExtra(Intent.EXTRA_STREAM, uris.get(0));
        else intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
        ClipData clips = ClipData.newUri(getContext().getContentResolver(), "Photos MODEXA", uris.get(0));
        for (int i = 1; i < uris.size(); i++) clips.addItem(new ClipData.Item(uris.get(i)));
        intent.setClipData(clips);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.setPackage("com.whatsapp");
        if (intent.resolveActivity(getContext().getPackageManager()) == null) intent.setPackage("com.whatsapp.w4b");
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("Installez WhatsApp ou WhatsApp Business pour partager vos photos."); return;
        }
        try {
            getActivity().startActivity(intent);
            // Keep the granted files available while WhatsApp reads them; prune after 24 hours.
            photos.clear(); session = null; bytes = 0; call.resolve();
        } catch (Exception error) { call.reject("Impossible d’ouvrir WhatsApp. Vérifiez son installation puis réessayez."); }
    }
}
