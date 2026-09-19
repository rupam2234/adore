import { Suspense } from 'react';
import LoginForm from './login-form';

export const metadata = {
  title: 'Admin Login',
  robots: { index: false, follow: false },
};

interface LoginPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next } = await searchParams;
  return (
    <Suspense fallback={<div className="mx-auto mt-24" />}>
      <LoginForm next={next ?? '/admin'} />
    </Suspense>
  );
}
