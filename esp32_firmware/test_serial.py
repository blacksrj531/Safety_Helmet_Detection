import sys
import time
import serial
import serial.tools.list_ports

PORT = "COM3"
BAUD = 115200

def run_test():
    print(f"Connecting to ESP32 on {PORT} at {BAUD} baud...")
    try:
        ser = serial.Serial(PORT, BAUD, timeout=2)
        time.sleep(2)  # Give ESP32 time to reboot if DTR reset occurs
        print("Connected!")

        print("\n--- Sending TEST ON (Helmet Detected -> 90 deg) ---")
        ser.write(b"ON\n")
        time.sleep(1)
        while ser.in_waiting:
            print("[ESP32 Reply]:", ser.readline().decode('utf-8', errors='ignore').strip())

        time.sleep(2)

        print("\n--- Sending TEST OFF (No Helmet -> 0 deg) ---")
        ser.write(b"OFF\n")
        time.sleep(1)
        while ser.in_waiting:
            print("[ESP32 Reply]:", ser.readline().decode('utf-8', errors='ignore').strip())

        ser.close()
        print("\nTest completed.")
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    run_test()
