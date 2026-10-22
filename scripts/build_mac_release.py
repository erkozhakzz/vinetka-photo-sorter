import os
import sys
import glob
import zipfile
import plistlib
import shutil
from pathlib import Path

def build_mac_release():
    print("=" * 60)
    print("  VINETKA PHOTO SORTER — СБОРЩИК MACOS РЕЛИЗА (.APP.ZIP)")
    print("=" * 60)

    base_dir = Path(__file__).resolve().parent.parent
    cache_glob = glob.glob(os.path.expandvars('%LOCALAPPDATA%/electron/Cache/**/electron-v32.1.2-darwin-arm64.zip'), recursive=True)
    if not cache_glob:
        print("[FAIL] electron-v32.1.2-darwin-arm64.zip не найден в кэше")
        sys.exit(1)

    template_zip = cache_glob[0]
    print(f"[1/4] Исходный Electron template: {template_zip}")

    dist_dir = base_dir / "dist"
    app_asar_path = dist_dir / "app.asar"
    unpacked_path = dist_dir / "app.asar.unpacked"

    if not app_asar_path.exists():
        print(f"[FAIL] {app_asar_path} не существует. Сначала запустите pack-asar.")
        sys.exit(1)

    out_zip_name = "VINETKA-Photo-Sorter-macOS-arm64.zip"
    out_zip_path = dist_dir / out_zip_name
    desktop_zip_path = Path(os.path.expanduser("~")) / "Desktop" / out_zip_name

    app_name = "VINETKA Photo Sorter.app"
    orig_prefix = "Electron.app/"
    new_prefix = f"{app_name}/"

    print(f"[2/4] Подготовка пакета macOS Apple Silicon (M1/M2/M3/M4)...")
    
    with zipfile.ZipFile(template_zip, 'r') as src_zip:
        with zipfile.ZipFile(out_zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as dst_zip:
            for item in src_zip.infolist():
                orig_name = item.filename
                
                # Пропускаем default_app.asar (заменяем нашим app.asar)
                if "default_app.asar" in orig_name:
                    continue

                new_name = orig_name
                if orig_name.startswith(orig_prefix):
                    new_name = new_prefix + orig_name[len(orig_prefix):]

                # Модифицируем Info.plist приложения
                if orig_name == "Electron.app/Contents/Info.plist":
                    data = src_zip.read(orig_name)
                    plist = plistlib.loads(data)
                    plist["CFBundleName"] = "VINETKA Photo Sorter"
                    plist["CFBundleDisplayName"] = "VINETKA Photo Sorter"
                    plist["CFBundleIdentifier"] = "kz.vinetka.photosorter"
                    plist["CFBundleVersion"] = "2.3.0"
                    plist["CFBundleShortVersionString"] = "2.3.0"
                    plist["CFBundleExecutable"] = "Electron"
                    plist["NSHighResolutionCapable"] = True
                    plist["NSRequiresAquaSystemAppearance"] = False
                    new_data = plistlib.dumps(plist)

                    info = zipfile.ZipInfo(new_name)
                    info.date_time = item.date_time
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = item.external_attr
                    dst_zip.writestr(info, new_data)
                    continue

                # Копируем остальные файлы и симлинки без изменений
                data = src_zip.read(orig_name)
                info = zipfile.ZipInfo(new_name)
                info.date_time = item.date_time
                info.compress_type = item.compress_type
                info.external_attr = item.external_attr
                dst_zip.writestr(info, data)

            print(f"[3/4] Добавление app.asar ({app_asar_path.stat().st_size / (1024*1024):.1f} MB)...")
            # Добавляем app.asar
            with open(app_asar_path, 'rb') as f:
                asar_data = f.read()
            asar_info = zipfile.ZipInfo(f"{new_prefix}Contents/Resources/app.asar")
            asar_info.external_attr = 0o100644 << 16  # rw-r--r--
            asar_info.compress_type = zipfile.ZIP_DEFLATED
            dst_zip.writestr(asar_info, asar_data)

            # Добавляем app.asar.unpacked
            if unpacked_path.exists():
                print(f"[3.1/4] Добавление app.asar.unpacked (модели и скрипты)...")
                for root, _, files in os.walk(unpacked_path):
                    for file in files:
                        full_p = Path(root) / file
                        rel_p = full_p.relative_to(dist_dir)
                        arc_name = f"{new_prefix}Contents/Resources/{rel_p.as_posix()}"
                        with open(full_p, 'rb') as uf:
                            u_data = uf.read()
                        u_info = zipfile.ZipInfo(arc_name)
                        is_executable = file.endswith('.py') or file.endswith('.sh')
                        perm = 0o100755 if is_executable else 0o100644
                        u_info.external_attr = perm << 16
                        u_info.compress_type = zipfile.ZIP_DEFLATED
                        dst_zip.writestr(u_info, u_data)

    shutil.copyfile(out_zip_path, desktop_zip_path)
    size_mb = desktop_zip_path.stat().st_size / (1024 * 1024)
    print(f"[4/4] Готово! macOS дистрибутив создан:")
    print(f"      -> {desktop_zip_path} ({size_mb:.1f} MB)")
    print(f"      -> {out_zip_path}")
    print("=" * 60)

if __name__ == "__main__":
    build_mac_release()
