import ArrayDiffChecker from "./ArrayDiffChecker";
import ObjectDiffChecker from "./ObjectDiffChecker";
import "./App.css";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { ThemeProvider } from "./components/theme-provider";
import { ModeToggle } from "./mode-toggle";

export default function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <div className="min-h-screen bg-background">

        <div className="max-w-7xl mx-auto p-6">
          <div className="flex align-center justify-between gap-3">
            <h1 className="text-4xl font-bold mb-8">JSON Diff Checker</h1>
            <ModeToggle />
          </div>

          <Tabs defaultValue="array" className="w-full">
            <TabsList className="flex gap-3 w-full">
              <TabsTrigger value="array">Array Checker</TabsTrigger>
              <TabsTrigger value="object">Object Checker</TabsTrigger>
            </TabsList>

            <TabsContent value="array" className="mt-6">
              <ArrayDiffChecker />
            </TabsContent>

            <TabsContent value="object" className="mt-6">
              <ObjectDiffChecker />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </ThemeProvider>
  );
}
