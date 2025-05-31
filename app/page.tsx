import Link from "next/link";

export default function Home() {
  return (
    <div className="flex justify-center items-center h-screen gap-4">
      <Link
        href={"/stream"}
        className="p-2 rounded-xl hover:border-violet-700 border-2"
      >
        Stream
      </Link>
      <Link
        href={"/watch"}
        className="p-2 rounded-xl hover:border-violet-700 border-2"
      >
        Watch
      </Link>
    </div>
  );
}