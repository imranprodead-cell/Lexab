/**
 * Google Picker — Google's own "pick a file" dialog. Used with the drive.file
 * scope: the app can only read files the user explicitly picks here.
 */

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
}

interface PickerData {
  action: string;
  docs?: { id: string; name: string; mimeType: string }[];
}

/** The tiny slice of the gapi/picker globals we actually touch. */
interface PickerView {
  setMimeTypes: (m: string) => PickerView;
  setIncludeFolders: (v: boolean) => PickerView;
  setSelectFolderEnabled: (v: boolean) => PickerView;
}
interface PickerBuilder {
  setOAuthToken: (t: string) => PickerBuilder;
  setDeveloperKey: (k: string) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  setLocale: (l: string) => PickerBuilder;
  addView: (v: PickerView) => PickerBuilder;
  setCallback: (cb: (data: PickerData) => void) => PickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
}
interface PickerGlobals {
  gapi?: { load: (api: string, opts: { callback: () => void; onerror?: () => void }) => void };
  google?: {
    picker?: {
      PickerBuilder: new () => PickerBuilder;
      DocsView: new (viewId?: unknown) => PickerView;
      ViewId: { DOCS: unknown };
      Action: { PICKED: string; CANCEL: string };
    };
  };
}

const win = window as unknown as PickerGlobals;

const PICKER_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/markdown',
  'application/vnd.google-apps.document',
].join(',');

export const GDOC_MIME = 'application/vnd.google-apps.document';

let pickerApi: Promise<void> | null = null;

/** Load api.js once and initialise the picker module. */
function loadPickerApi(): Promise<void> {
  if (win.google?.picker) return Promise.resolve();
  if (pickerApi) return pickerApi;
  pickerApi = new Promise<void>((resolve, reject) => {
    const fail = () => {
      pickerApi = null;
      reject(new Error('Google Picker failed to load'));
    };
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.onload = () => {
      if (!win.gapi) return fail();
      win.gapi.load('picker', { callback: resolve, onerror: fail });
    };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return pickerApi;
}

/** Open the dialog; resolves with the picked file or null on cancel. */
export async function openDrivePicker(opts: {
  accessToken: string;
  apiKey?: string;
  appId?: string;
  locale: string;
}): Promise<PickedFile | null> {
  await loadPickerApi();
  const picker = win.google?.picker;
  if (!picker) throw new Error('Google Picker unavailable');

  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS)
      .setMimeTypes(PICKER_MIMES)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);

    let builder = new picker.PickerBuilder()
      .setOAuthToken(opts.accessToken)
      .setLocale(opts.locale)
      .addView(view)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) {
          const doc = data.docs?.[0];
          resolve(doc ? { id: doc.id, name: doc.name, mimeType: doc.mimeType } : null);
        } else if (data.action === picker.Action.CANCEL) {
          resolve(null);
        }
      });
    if (opts.apiKey) builder = builder.setDeveloperKey(opts.apiKey);
    if (opts.appId) builder = builder.setAppId(opts.appId);
    builder.build().setVisible(true);
  });
}
