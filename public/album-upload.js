/*
 * Album upload helpers.
 *
 * This module is intentionally dependency-free so it can be used by the
 * existing inline handlers in index.html without changing the current UI.
 */
(() => {
    'use strict';

    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    const DEFAULT_LABEL = 'Ketuk untuk pilih dari galeri atau kamera';

    const get = (id) => document.getElementById(id);

    function setUploadVisibility(visible) {
        const form = get('photo-upload-form');
        if (!form) return;

        form.classList.toggle('hidden', !visible);
        form.style.display = visible ? 'flex' : 'none';
    }

    function resetPreview() {
        const preview = get('photo-preview');
        if (!preview) return;

        preview.removeAttribute('src');
        preview.style.display = 'none';
    }

    function validateImage(file) {
        if (!file) return 'Pilih file gambar terlebih dahulu!';
        if (!ALLOWED_TYPES.has(file.type)) {
            return 'Format foto tidak didukung. Gunakan JPG, PNG, WEBP, atau GIF.';
        }
        if (file.size > MAX_FILE_SIZE) {
            return 'Ukuran foto maksimal 5 MB.';
        }
        return '';
    }

    function showPreview(file) {
        const preview = get('photo-preview');
        if (!preview) return;

        const objectUrl = URL.createObjectURL(file);
        preview.onload = () => URL.revokeObjectURL(objectUrl);
        preview.src = objectUrl;
        preview.style.display = 'block';
    }

    window.onAlbumFileChange = function onAlbumFileChange(event) {
        const file = event?.target?.files?.[0];
        const error = validateImage(file);

        if (error) {
            if (event?.target) event.target.value = '';
            resetPreview();
            setUploadVisibility(false);
            alert(error);
            return;
        }

        const label = get('selected-file-label');
        if (label) label.textContent = `Terpilih: ${file.name}`;

        setUploadVisibility(true);
        showPreview(file);
    };

    window.cancelAlbumUpload = function cancelAlbumUpload() {
        const input = get('photo-file-input');
        const label = get('selected-file-label');
        const caption = get('photo-caption-input');

        if (input) input.value = '';
        if (label) label.textContent = DEFAULT_LABEL;
        if (caption) caption.value = '';

        resetPreview();
        setUploadVisibility(false);
    };

    // Expose the shared validation for the upload handler in app.js.
    window.validateAlbumImage = validateImage;
    window.ALBUM_MAX_FILE_SIZE = MAX_FILE_SIZE;
})();
