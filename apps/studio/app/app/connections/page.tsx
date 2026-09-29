import Link from 'next/link';
import { StudioShell, Intro, Notice } from '../instagram/_shared';
export default function Page(){return <StudioShell><Intro title="Conectar Instagram"/><Notice>Esta instalação preserva o módulo visual original. Para conectar uma conta real, implemente o adapter social e a autorização descritos em docs/integration.md.</Notice><Link href="/app/instagram">Voltar ao Instagram</Link></StudioShell>;}
