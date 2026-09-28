(() => {
  'use strict';

  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  const ALLOWED_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]);

  const ALLOWED_EXTENSIONS = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.gif'
  ]);

  const DEFAULT_LABEL = 'Ketuk untuk pilih dari galeri atau kamera';
  const MAX_DISPLAY_FILENAME_LENGTH = 45;

  let currentPreviewUrl = null;

  function getElement(id) {
    return document.getElementById(id);
  }

  function getFileExtension(filename) {
    const value = String(filename || '').toLowerCase();
    const lastDot = value.lastIndexOf('.');

    if (lastDot === -1) {
      return '';
    }

    return value.slice(lastDot);
  }

  function setUploadVisibility(visible) {
    const form = getElement('photo-upload-form');

    if (!form) {
      return;
    }

    form.classList.toggle('hidden', !visible);
    form.style.display = visible ? 'flex' : 'none';

    if (visible) {
      form.setAttribute('aria-hidden', 'false');
    } else {
      form.setAttribute('aria-hidden', 'true');
    }
  }

  function setSubmitState(disabled) {
    const form = getElement('photo-upload-form');

    if (!form) {
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');

    if (submitButton) {
      submitButton.disabled = disabled;
    }
  }

  function revokePreviewUrl() {
    if (!currentPreviewUrl) {
      return;
    }

    URL.revokeObjectURL(currentPreviewUrl);
    currentPreviewUrl = null;
  }

  function resetPreview() {
    const preview = getElement('photo-preview');

    revokePreviewUrl();

    if (!preview) {
      return;
    }

    preview.removeAttribute('src');
    preview.style.display = 'none';
    preview.alt = 'Pratinjau foto';
  }

  function resetUploadState() {
    const input = getElement('photo-file-input');
    const label = getElement('selected-file-label');
    const caption = getElement('photo-caption-input');

    if (input) {
      input.value = '';
    }

    if (label) {
      label.textContent = DEFAULT_LABEL;
    }

    if (caption) {
      caption.value = '';
    }

    resetPreview();
    setSubmitState(false);
    setUploadVisibility(false);
  }

  function validateImage(file) {
    if (!file) {
      return 'Pilih file gambar terlebih dahulu.';
    }

    if (!(file instanceof File)) {
      return 'File gambar tidak valid.';
    }

    if (file.size <= 0) {
      return 'File gambar kosong atau rusak.';
    }

    if (file.size > MAX_FILE_SIZE) {
      return 'Ukuran foto maksimal adalah 10MB.';
    }

    const mimeType = String(file.type || '').toLowerCase();
    const extension = getFileExtension(file.name);

    const validMimeType = ALLOWED_TYPES.has(mimeType);
    const validExtension = ALLOWED_EXTENSIONS.has(extension);

    // Beberapa perangkat Android tidak selalu mengirim MIME type.
    // Backend tetap melakukan validasi ulang menggunakan multer.
    if (!validMimeType && !validExtension) {
      return 'Format foto tidak didukung. Gunakan JPG, PNG, WEBP, atau GIF.';
    }

    return '';
  }

  function formatFilename(filename) {
    const value = String(filename || '');

    if (value.length <= MAX_DISPLAY_FILENAME_LENGTH) {
      return value;
    }

    const extension = getFileExtension(value);
    const availableLength =
      MAX_DISPLAY_FILENAME_LENGTH - extension.length - 3;

    return `${value.slice(0, Math.max(1, availableLength))}...${extension}`;
  }

  function showPreview(file) {
    const preview = getElement('photo-preview');

    if (!preview || !file) {
      return;
    }

    revokePreviewUrl();

    currentPreviewUrl = URL.createObjectURL(file);

    preview.onload = () => {
      if (currentPreviewUrl) {
        URL.revokeObjectURL(currentPreviewUrl);
        currentPreviewUrl = null;
      }
    };

    preview.onerror = () => {
      revokePreviewUrl();
      preview.removeAttribute('src');
      preview.style.display = 'none';

      alert('Pratinjau foto gagal dimuat. Silakan pilih file lain.');
    };

    preview.src = currentPreviewUrl;
    preview.alt = `Pratinjau ${file.name}`;
    preview.style.display = 'block';
  }

  function showUploadError(message) {
    resetUploadState();
    alert(message);
  }

  window.onAlbumFileChange = function onAlbumFileChange(event) {
    const input = event?.target;
    const file = input?.files?.[0] || null;
    const validationError = validateImage(file);

    if (validationError) {
      showUploadError(validationError);
      return;
    }

    const label = getElement('selected-file-label');

    if (label) {
      label.textContent = `Terpilih: ${formatFilename(file.name)}`;
      label.title = file.name;
    }

    setUploadVisibility(true);
    setSubmitState(false);
    showPreview(file);
  };

  window.cancelAlbumUpload = function cancelAlbumUpload() {
    resetUploadState();
  };

  window.validateAlbumImage = validateImage;
  window.ALBUM_MAX_FILE_SIZE = MAX_FILE_SIZE;

  window.addEventListener('beforeunload', () => {
    revokePreviewUrl();
  });
})();
