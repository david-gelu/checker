import React, { useState } from "react";
import { AlertCircle, CheckCircle, Copy } from "lucide-react";

export default function ArrayDiffChecker() {
  const [array1, setArray1] = useState("");
  const [array2, setArray2] = useState("");
  const [results, setResults] = useState(null);

  const analyzeArrays = () => {
    try {
      // Parse arrays
      const arr1 = JSON.parse(array1);
      const arr2 = JSON.parse(array2);

      if (!Array.isArray(arr1) || !Array.isArray(arr2)) {
        alert("Ambele input-uri trebuie să fie array-uri valide!");
        return;
      }

      // Find duplicates in each array
      const duplicates1 = findDuplicates(arr1);
      const duplicates2 = findDuplicates(arr2);

      // Convert to sets for comparison
      const set1 = new Set(arr1);
      const set2 = new Set(arr2);

      // Find differences
      const onlyInArray1 = arr1.filter((item) => !set2.has(item));
      const onlyInArray2 = arr2.filter((item) => !set1.has(item));
      const inBoth = arr1.filter((item) => set2.has(item));

      setResults({
        length1: arr1.length,
        length2: arr2.length,
        uniqueLength1: set1.size,
        uniqueLength2: set2.size,
        duplicates1,
        duplicates2,
        onlyInArray1: [...new Set(onlyInArray1)],
        onlyInArray2: [...new Set(onlyInArray2)],
        inBoth: inBoth.length,
      });
    } catch (error) {
      alert("Eroare la parsarea array-urilor: " + error.message);
    }
  };

  const findDuplicates = (arr) => {
    const counts = {};
    arr.forEach((item) => {
      counts[item] = (counts[item] || 0) + 1;
    });
    return Object.entries(counts)
      .filter(([_, count]) => count > 1)
      .map(([item, count]) => ({ item, count }));
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-800 mb-6">
          Array Difference Checker
        </h1>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Array 1
            </label>
            <textarea
              value={array1}
              onChange={(e) => setArray1(e.target.value)}
              className="w-full h-64 p-3 border border-gray-300 rounded-lg font-mono text-sm"
              placeholder='["item1", "item2", "item3"]'
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Array 2
            </label>
            <textarea
              value={array2}
              onChange={(e) => setArray2(e.target.value)}
              className="w-full h-64 p-3 border border-gray-300 rounded-lg font-mono text-sm"
              placeholder='["item1", "item2", "item4"]'
            />
          </div>
        </div>

        <button
          onClick={analyzeArrays}
          className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition mb-6"
        >
          Analizează Diferențele
        </button>

        {results && (
          <div className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-white p-4 rounded-lg shadow">
                <h3 className="font-bold text-lg mb-2 text-blue-600">
                  Array 1
                </h3>
                <p className="text-sm">
                  Lungime totală:{" "}
                  <span className="font-bold">{results.length1}</span>
                </p>
                <p className="text-sm">
                  Elemente unice:{" "}
                  <span className="font-bold">{results.uniqueLength1}</span>
                </p>
              </div>

              <div className="bg-white p-4 rounded-lg shadow">
                <h3 className="font-bold text-lg mb-2 text-purple-600">
                  Array 2
                </h3>
                <p className="text-sm">
                  Lungime totală:{" "}
                  <span className="font-bold">{results.length2}</span>
                </p>
                <p className="text-sm">
                  Elemente unice:{" "}
                  <span className="font-bold">{results.uniqueLength2}</span>
                </p>
              </div>
            </div>

            {results.duplicates1.length > 0 && (
              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
                <div className="flex items-start">
                  <AlertCircle
                    className="text-yellow-600 mr-2 flex-shrink-0"
                    size={20}
                  />
                  <div className="flex-1">
                    <h4 className="font-bold text-yellow-800 mb-2">
                      Duplicate în Array 1:
                    </h4>
                    <div className="space-y-1">
                      {results.duplicates1.map((dup, idx) => (
                        <p key={idx} className="text-sm text-yellow-700">
                          "{dup.item}" - apare de {dup.count} ori
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {results.duplicates2.length > 0 && (
              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
                <div className="flex items-start">
                  <AlertCircle
                    className="text-yellow-600 mr-2 flex-shrink-0"
                    size={20}
                  />
                  <div className="flex-1">
                    <h4 className="font-bold text-yellow-800 mb-2">
                      Duplicate în Array 2:
                    </h4>
                    <div className="space-y-1">
                      {results.duplicates2.map((dup, idx) => (
                        <p key={idx} className="text-sm text-yellow-700">
                          "{dup.item}" - apare de {dup.count} ori
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {results.onlyInArray1.length > 0 && (
              <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-bold text-blue-800 mb-2">
                      Doar în Array 1 ({results.onlyInArray1.length} elemente):
                    </h4>
                    <div className="max-h-48 overflow-y-auto">
                      {results.onlyInArray1.map((item, idx) => (
                        <p key={idx} className="text-sm text-blue-700">
                          "{item}"
                        </p>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        JSON.stringify(results.onlyInArray1, null, 2)
                      )
                    }
                    className="ml-2 p-2 hover:bg-blue-100 rounded"
                    title="Copiază"
                  >
                    <Copy size={16} className="text-blue-600" />
                  </button>
                </div>
              </div>
            )}

            {results.onlyInArray2.length > 0 && (
              <div className="bg-purple-50 border-l-4 border-purple-400 p-4 rounded">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-bold text-purple-800 mb-2">
                      Doar în Array 2 ({results.onlyInArray2.length} elemente):
                    </h4>
                    <div className="max-h-48 overflow-y-auto">
                      {results.onlyInArray2.map((item, idx) => (
                        <p key={idx} className="text-sm text-purple-700">
                          "{item}"
                        </p>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        JSON.stringify(results.onlyInArray2, null, 2)
                      )
                    }
                    className="ml-2 p-2 hover:bg-purple-100 rounded"
                    title="Copiază"
                  >
                    <Copy size={16} className="text-purple-600" />
                  </button>
                </div>
              </div>
            )}

            <div className="bg-green-50 border-l-4 border-green-400 p-4 rounded">
              <div className="flex items-start">
                <CheckCircle
                  className="text-green-600 mr-2 flex-shrink-0"
                  size={20}
                />
                <div>
                  <h4 className="font-bold text-green-800">
                    Elemente comune: {results.inBoth}
                  </h4>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
