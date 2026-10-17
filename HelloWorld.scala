/**
 * HelloWorld.scala
 * 
 * A simple Scala program that prints "Hello, World!" to the console.
 * 
 * To run this program:
 *   1. Ensure you have Scala installed (version 2.13 or 3.x recommended).
 *   2. Compile the program: scalac HelloWorld.scala
 *   3. Run the compiled class: scala HelloWorld
 * 
 * Alternatively, you can run it directly with the Scala interpreter:
 *   scala HelloWorld.scala
 * 
 * This program follows Scala best practices:
 *   - Uses an object with a main method as the entry point.
 *   - Uses the standard library's Predef.println for output.
 *   - No external dependencies.
 */

object HelloWorld {
  def main(args: Array[String]): Unit = {
    println("Hello, World!")
  }
}