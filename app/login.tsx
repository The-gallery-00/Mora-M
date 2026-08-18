import { Redirect } from 'expo-router';

export default function LoginAlias() {
  return <Redirect href="/(auth)/login" />;
}
