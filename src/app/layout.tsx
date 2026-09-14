import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Code Atlas',
  description: 'Git과 로컬 소스로 팀의 변경 맥락을 읽는 작업대',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
