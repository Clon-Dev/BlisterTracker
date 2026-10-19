// react-native-web's Alert is a no-op, so use the browser dialogs.
export const notify = (title: string, message?: string) => window.alert(message ? `${title}\n\n${message}` : title);
export const confirm = async (title: string, message: string, _ok?: string) => window.confirm(`${title}\n\n${message}`);
