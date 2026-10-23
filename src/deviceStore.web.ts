// Web / iPhone home-screen app: the browser's storage for this site (cleared with the site data).
const read = (name: string) => { try { return localStorage.getItem(name); } catch { return null; } };

export const deviceGet = async (name: string) => read(name);
export const deviceSet = async (name: string, value: string) => { try { localStorage.setItem(name, value); } catch { /* private mode: unlock again next time */ } };
export const deviceRemove = async (name: string) => { try { localStorage.removeItem(name); } catch { /* nothing stored */ } };
